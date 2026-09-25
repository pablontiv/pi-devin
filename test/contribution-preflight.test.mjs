import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = resolve("scripts/contribution-preflight.sh");
const identityEnv = {
  GIT_AUTHOR_NAME: "Preflight Test",
  GIT_AUTHOR_EMAIL: "preflight@example.invalid",
  GIT_COMMITTER_NAME: "Preflight Test",
  GIT_COMMITTER_EMAIL: "preflight@example.invalid",
};

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd: options.cwd,
    env: { ...process.env, ...identityEnv, ...options.env },
    encoding: "utf8",
  });
  if (options.allowFailure !== true && result.status !== 0) {
    throw new Error(`${commandName} ${args.join(" ")} failed (${result.status})\n${result.stdout}${result.stderr}`);
  }
  return result;
}

function git(cwd, ...args) {
  return command("git", args, { cwd }).stdout.trim();
}

function commitFile(cwd, path, contents, message) {
  const target = join(cwd, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  git(cwd, "add", path);
  git(cwd, "commit", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

function createFixture({ integration = false, conflict = false, validationFailure = false, originTagDiverges = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pi-devin-preflight-"));
  const seed = join(root, "seed");
  const remotes = {
    origin: join(root, "origin.git"),
    upstream: join(root, "upstream.git"),
    mizorewww: join(root, "mizorewww.git"),
  };
  mkdirSync(seed);
  git(seed, "init", "--initial-branch=main");
  git(seed, "config", "user.name", "Preflight Test");
  git(seed, "config", "user.email", "preflight@example.invalid");
  const packageJson = validationFailure
    ? { scripts: { test: "node -e \"process.exit(19)\"", typecheck: "node -e \"process.exit(0)\"" } }
    : { scripts: { test: "node -e \"process.exit(0)\"", typecheck: "node -e \"process.exit(0)\"" } };
  writeFileSync(join(seed, "package.json"), `${JSON.stringify(packageJson)}\n`);
  writeFileSync(join(seed, "conflict.txt"), "base\n");
  git(seed, "add", ".");
  git(seed, "commit", "-m", "base");
  const base = git(seed, "rev-parse", "HEAD");

  for (const path of Object.values(remotes)) {
    command("git", ["init", "--bare", path]);
    command("git", ["symbolic-ref", "HEAD", "refs/heads/main"], { cwd: path });
  }
  for (const [name, path] of Object.entries(remotes)) {
    git(seed, "remote", "add", name, path);
    git(seed, "push", name, "main");
  }

  git(seed, "tag", "v0.1.0", base);
  git(seed, "push", "upstream", "refs/tags/v0.1.0");
  if (!originTagDiverges) git(seed, "push", "origin", "refs/tags/v0.1.0");

  const upstream = commitFile(
    seed,
    conflict ? "conflict.txt" : "upstream.txt",
    conflict ? "upstream\n" : "upstream\n",
    "upstream change",
  );
  git(seed, "push", "upstream", "main");

  const mizore = commitFile(seed, "mizorewww.txt", "historical\n", "mizorewww change");
  git(seed, "update-ref", "refs/tags/v0.1.0", mizore);
  git(seed, "tag", "v0.2.0-mizorewww", mizore);
  git(seed, "push", "mizorewww", "main", "refs/tags/v0.1.0", "refs/tags/v0.2.0-mizorewww");

  if (originTagDiverges) {
    git(seed, "update-ref", "refs/tags/v0.1.0", mizore);
    git(seed, "push", "origin", "refs/tags/v0.1.0");
  }

  const globalConfig = join(root, "gitconfig");
  writeFileSync(globalConfig, "");
  const canonical = {
    origin: "https://github.com/pablontiv/pi-devin.git",
    upstream: "https://github.com/kashyab12/pi-devin.git",
    mizorewww: "https://github.com/mizorewww/pi-devin.git",
  };
  for (const name of Object.keys(remotes)) {
    command("git", ["config", "--file", globalConfig, `url.file://${remotes[name]}.insteadOf`, canonical[name]]);
  }

  const primary = join(root, "primary");
  command("git", ["clone", remotes.origin, primary]);
  git(primary, "config", "user.name", "Preflight Test");
  git(primary, "config", "user.email", "preflight@example.invalid");
  git(primary, "remote", "set-url", "origin", canonical.origin);
  git(primary, "remote", "add", "upstream", canonical.upstream);
  git(primary, "remote", "add", "mizorewww", canonical.mizorewww);

  const task = join(root, "task");
  git(primary, "worktree", "add", "-b", "task/test", task, base);
  let integrationPath;
  if (integration) {
    integrationPath = join(root, "integration");
    git(primary, "worktree", "add", "-b", "local/integration", integrationPath, base);
    commitFile(
      integrationPath,
      conflict ? "conflict.txt" : "integration.txt",
      conflict ? "integration\n" : "integration\n",
      "integration change",
    );
  }

  const bin = join(root, "bin");
  mkdirSync(bin);
  const bd = join(bin, "bd");
  writeFileSync(bd, `#!/bin/sh\nprintf '[{"id":"pi-devin-ppk","status":"%s"}]\\n' "\${MOCK_PPK_STATUS:-open}"\n`);
  chmodSync(bd, 0o755);

  const env = {
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    PATH: `${bin}:${process.env.PATH}`,
  };

  function run(args, extraEnv = {}) {
    return command("bash", [script, ...args], {
      cwd: task,
      env: { ...env, ...extraEnv },
      allowFailure: true,
    });
  }

  return { root, seed, remotes, primary, task, integrationPath, base, upstream, mizore, env, run };
}

function ref(cwd, name) {
  return git(cwd, "rev-parse", name);
}

function refs(cwd) {
  return git(cwd, "for-each-ref", "--format=%(refname) %(objectname)");
}

function output(result) {
  return `${result.stdout}${result.stderr}`;
}

test("bootstrap accepts only the three authorized Beads while ppk is open and integration is absent", () => {
  const fixture = createFixture();
  const mainBefore = ref(fixture.primary, "refs/heads/main");
  for (const id of ["pi-devin-1s2", "pi-devin-3l6", "pi-devin-ppk"]) {
    const result = fixture.run(["--bootstrap", id]);
    assert.equal(result.status, 0, output(result));
  }
  assert.equal(ref(fixture.primary, "refs/heads/main"), mainBefore);
  assert.equal(command("git", ["show-ref", "--verify", "--quiet", "refs/heads/local/integration"], { cwd: fixture.primary, allowFailure: true }).status, 1);

  const unauthorized = fixture.run(["--bootstrap", "pi-devin-other"]);
  assert.notEqual(unauthorized.status, 0);
  assert.match(output(unauthorized), /not authorized/i);

  const closed = fixture.run(["--bootstrap", "pi-devin-1s2"], { MOCK_PPK_STATUS: "closed" });
  assert.notEqual(closed.status, 0);
  assert.match(output(closed), /pi-devin-ppk.*open/i);
});

test("bootstrap verifies exact remotes before fetching", () => {
  const fixture = createFixture();
  git(fixture.primary, "config", "remote.origin.url", "https://github.com/not-pablontiv/pi-devin.git");
  const before = refs(fixture.primary);
  const result = fixture.run(["--bootstrap", "pi-devin-1s2"]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /origin.*pablontiv\/pi-devin/i);
  assert.equal(refs(fixture.primary), before);
});

test("bootstrap rejects a dirty selected task worktree", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.task, "dirty.txt"), "dirty\n");
  const result = fixture.run(["--bootstrap", "pi-devin-1s2"]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /clean.*worktree|worktree.*clean/i);
});

test("bootstrap installs canonical and namespaced tags without changing or pruning existing refs", () => {
  const fixture = createFixture();
  git(fixture.primary, "update-ref", "refs/tags/mizorewww/preserved-local", fixture.base);
  git(fixture.primary, "update-ref", "refs/evidence/preserved", fixture.base);
  const mainBefore = ref(fixture.primary, "refs/heads/main");
  const taskBefore = ref(fixture.primary, "refs/heads/task/test");
  const result = fixture.run(["--bootstrap", "pi-devin-1s2"]);
  assert.equal(result.status, 0, output(result));
  assert.equal(ref(fixture.primary, "refs/tags/v0.1.0"), fixture.base, "unqualified tag must remain canonical");
  assert.equal(ref(fixture.primary, "refs/tags/mizorewww/v0.1.0"), fixture.mizore, "same-name downstream tag must be namespaced");
  assert.equal(ref(fixture.primary, "refs/tags/mizorewww/v0.2.0-mizorewww"), fixture.mizore, "mizorewww-only tag must be retained");
  assert.equal(ref(fixture.primary, "refs/tags/mizorewww/preserved-local"), fixture.base, "the namespaced tag collection must not be pruned");
  assert.equal(ref(fixture.primary, "refs/evidence/preserved"), fixture.base, "unrelated refs must be preserved");
  assert.equal(ref(fixture.primary, "refs/heads/main"), mainBefore);
  assert.equal(ref(fixture.primary, "refs/heads/task/test"), taskBefore);
});

test("origin/upstream tag divergence is rejected without losing refs", () => {
  const fixture = createFixture({ originTagDiverges: true });
  git(fixture.primary, "update-ref", "refs/recovery/sentinel", fixture.base);
  git(fixture.primary, "tag", "local-only", fixture.base);
  const sentinel = ref(fixture.primary, "refs/recovery/sentinel");
  const localTag = ref(fixture.primary, "refs/tags/local-only");
  const originTag = ref(fixture.primary, "refs/tags/v0.1.0");
  const result = fixture.run(["--bootstrap", "pi-devin-1s2"]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /tag.*v0\.1\.0.*differ|collision/i);
  assert.equal(ref(fixture.primary, "refs/recovery/sentinel"), sentinel);
  assert.equal(ref(fixture.primary, "refs/tags/local-only"), localTag);
  assert.equal(ref(fixture.primary, "refs/tags/v0.1.0"), originTag);
});

test("a divergent local canonical tag fails without force or ref loss", () => {
  const fixture = createFixture();
  const localCommit = commitFile(fixture.primary, "local-tag.txt", "local\n", "local tag target");
  git(fixture.primary, "update-ref", "refs/tags/v0.1.0", localCommit);
  git(fixture.primary, "update-ref", "refs/recovery/sentinel", fixture.base);
  const result = fixture.run(["--bootstrap", "pi-devin-1s2"]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /canonical.*tag|fetch.*tag|rejected/i);
  assert.equal(ref(fixture.primary, "refs/tags/v0.1.0"), localCommit);
  assert.equal(ref(fixture.primary, "refs/recovery/sentinel"), fixture.base);
});

test("bootstrap stops when local/integration exists", () => {
  const fixture = createFixture({ integration: true });
  const integrationBefore = ref(fixture.primary, "refs/heads/local/integration");
  const result = fixture.run(["--bootstrap", "pi-devin-1s2"]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /bootstrap.*local\/integration|local\/integration.*absent/i);
  assert.equal(ref(fixture.primary, "refs/heads/local/integration"), integrationBefore);
});

test("normal mode fails closed when the integration worktree is missing", () => {
  const fixture = createFixture();
  const mainBefore = ref(fixture.primary, "refs/heads/main");
  const result = fixture.run(["--normal", "pi-devin-1s2"]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /integration worktree.*missing|missing.*local\/integration/i);
  assert.equal(ref(fixture.primary, "refs/heads/main"), mainBefore);
});

test("normal mode fast-forwards main, creates recovery ref, rebases integration, validates, and reports SHAs", () => {
  const fixture = createFixture({ integration: true });
  const integrationBefore = ref(fixture.primary, "refs/heads/local/integration");
  const result = fixture.run(["--normal", "pi-devin-3l6"]);
  assert.equal(result.status, 0, output(result));
  assert.equal(ref(fixture.primary, "refs/heads/main"), fixture.upstream);
  const integrationAfter = ref(fixture.primary, "refs/heads/local/integration");
  assert.notEqual(integrationAfter, integrationBefore);
  assert.equal(git(fixture.primary, "merge-base", integrationAfter, fixture.upstream), fixture.upstream);
  const recoveryLines = git(fixture.primary, "for-each-ref", "--format=%(objectname)", "refs/recovery/contribution-preflight/").split("\n").filter(Boolean);
  assert.deepEqual(recoveryLines, [integrationBefore]);
  assert.match(output(result), new RegExp(`main before: ${fixture.base}`));
  assert.match(output(result), new RegExp(`main after: ${fixture.upstream}`));
  assert.match(output(result), new RegExp(`integration before: ${integrationBefore}`));
  assert.match(output(result), new RegExp(`integration after: ${integrationAfter}`));
});

test("normal mode stops before changes when main cannot fast-forward", () => {
  const fixture = createFixture({ integration: true });
  const mainBefore = commitFile(fixture.primary, "local-main.txt", "ahead\n", "local main divergence");
  const integrationBefore = ref(fixture.primary, "refs/heads/local/integration");
  const result = fixture.run(["--normal", "pi-devin-1s2"]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /fast-forward/i);
  assert.equal(ref(fixture.primary, "refs/heads/main"), mainBefore);
  assert.equal(ref(fixture.primary, "refs/heads/local/integration"), integrationBefore);
  assert.equal(git(fixture.primary, "for-each-ref", "--format=%(refname)", "refs/recovery/contribution-preflight/"), "");
});

test("normal mode preserves conflict state and the recovery ref", () => {
  const fixture = createFixture({ integration: true, conflict: true });
  const integrationBefore = ref(fixture.primary, "refs/heads/local/integration");
  const result = fixture.run(["--normal", "pi-devin-1s2"]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /rebase.*conflict|conflict.*preserved/i);
  assert.equal(ref(fixture.primary, "refs/heads/main"), fixture.upstream);
  assert.equal(git(fixture.primary, "for-each-ref", "--format=%(objectname)", "refs/recovery/contribution-preflight/"), integrationBefore);
  const gitPath = git(fixture.integrationPath, "rev-parse", "--git-path", "rebase-merge");
  assert.equal(command("test", ["-d", gitPath], { allowFailure: true }).status, 0, "rebase metadata must remain present");
});

test("normal mode propagates validation failure after preserving recovery state", () => {
  const fixture = createFixture({ integration: true, validationFailure: true });
  const integrationBefore = ref(fixture.primary, "refs/heads/local/integration");
  const result = fixture.run(["--normal", "pi-devin-1s2"]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /npm test.*failed|validation.*failed/i);
  assert.equal(git(fixture.primary, "for-each-ref", "--format=%(objectname)", "refs/recovery/contribution-preflight/"), integrationBefore);
});

test("script is syntactically valid and contains no write-to-remote or destructive recovery command", () => {
  const syntax = command("bash", ["-n", script], { allowFailure: true });
  assert.equal(syntax.status, 0, output(syntax));
  const source = readFileSync(script, "utf8");
  assert.doesNotMatch(source, /\bgit\s+push\b/u);
  assert.doesNotMatch(source, /\bgit\s+reset\b/u);
  assert.doesNotMatch(source, /\bgit\s+rebase\s+--abort\b/u);
  assert.doesNotMatch(source, /--force|-f\b/u);
});
