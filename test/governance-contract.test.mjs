import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const surfaces = new Map([
  [".workspace/config.yaml", readFileSync(".workspace/config.yaml", "utf8")],
  ["AGENTS.md", readFileSync("AGENTS.md", "utf8")],
  ["CONTRIBUTING.md", readFileSync("CONTRIBUTING.md", "utf8")],
]);

const policies = [
  ["origin identity and role", /origin.*?(?:pablontiv\/pi-devin|github\.com\/pablontiv\/pi-devin).*?(?:writable|push)/i],
  ["upstream identity and read-only role", /upstream.*?(?:kashyab12\/pi-devin|github\.com\/kashyab12\/pi-devin).*?read-only/i],
  ["mizorewww identity and provenance-only role", /mizorewww.*?(?:mizorewww\/pi-devin|github\.com\/mizorewww\/pi-devin).*?provenance-only/i],
  ["mandatory issue and focused PR", /every upstreamable feature or bug.*?(?:own|dedicated) upstream issue.*?focused (?:upstream )?(?:pull request|PR)/i],
  ["PR links its issue", /(?:pull request|PR).*?links? (?:its|that|the) issue/i],
  ["direct upstream write ban", /never (?:push|write) directly to [`'“]?upstream/i],
  ["integration branch PR-head ban", /local\/integration.*?(?:must never|is never|never be).*?(?:PR|pull request) head/i],
  ["literal attribution", /literal(?:ly copied)? work.*?(?:preserve|retain).*?(?:original )?author.*?(?:repository|repo).*?commit/i],
  ["adapted attribution", /adapted work.*?(?:Based-on|based on).*?(?:repository|repo).*?commit/i],
  ["downstream-only exclusions", /already present upstream.*?package-name.*?release-only.*?translation-only.*?(?:not|never) (?:resubmitted|submit)/i],
  ["human gate for posts and comments", /human approval.*?before.*?post(?:ing)?.*?(?:issue|comment)/i],
  ["human gate for PR changes", /human approval.*?before.*?open(?:ing)?.*?updat(?:e|ing).*?(?:pull request|PR)/i],
  ["human gate for remaining external effects", /human approval.*?before.*?merg(?:e|ing).*?publish(?:ing)?.*?push(?:ing)?.*?external effect/i],
  ["Humanizer covers every GitHub text field", /every issue or PR title, body, and comment/i],
  ["Humanizer version and mode", /Humanizer v3\.0\.0.*?embedded mode/i],
  ["Humanizer runs before approval or posting", /Humanizer v3\.0\.0.*?before approval or posting/i],
  ["Humanizer installed source", /\/Users\/pones\/\.pi\/agent\/skills\/humanizer\/SKILL\.md/],
  ["Humanizer protected content", /preserv(?:e|ing).*?facts.*?identifiers.*?code.*?commands.*?paths.*?(?:links|link targets).*?attribution.*?uncertainty/i],
  ["Humanizer is not authorization", /Humanizer never authorizes (?:posting|the external action)/i],
];

function validateMarkdown(path, source) {
  assert.match(source, /^# [^\n]+/u, `${path} must start with one H1`);
  assert.equal((source.match(/^# /gmu) ?? []).length, 1, `${path} must contain exactly one H1`);
  assert.equal((source.match(/^```/gmu) ?? []).length % 2, 0, `${path} must have balanced code fences`);
  assert.doesNotMatch(source, /\[[^\]]+\]\(\s*\)/u, `${path} must not contain empty Markdown links`);
}

test("governance Markdown is structurally valid", () => {
  validateMarkdown("AGENTS.md", surfaces.get("AGENTS.md"));
  validateMarkdown("CONTRIBUTING.md", surfaces.get("CONTRIBUTING.md"));
});

test("workspace control declares both governance context sources", () => {
  const config = surfaces.get(".workspace/config.yaml");
  assert.match(config, /^schema_version: workspace-control\/v1$/mu);
  assert.match(config, /^  context_sources:\n    - AGENTS\.md\n    - CONTRIBUTING\.md$/mu);
  assert.doesNotMatch(config, /\t/u, "workspace YAML must use spaces, not tabs");
});

for (const [surface, source] of surfaces) {
  test(`${surface} contains the complete contribution governance contract`, async (t) => {
    const normalized = source.replace(/\s+/gu, " ");
    for (const [name, pattern] of policies) {
      await t.test(name, () => assert.match(normalized, pattern));
    }
  });
}
