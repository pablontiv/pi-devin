import assert from "node:assert/strict";
import test from "node:test";
import { clearCachedUserJwt, mintUserJwt } from "../src/jwt.ts";
import { encodeMessage, iterFields } from "../src/wire.ts";

const fields = (buffer) => [...iterFields(buffer)];

test("mints the user JWT with the resolved Devin client version", async (t) => {
  clearCachedUserJwt();
  t.after(clearCachedUserJwt);
  let advertisedVersion;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const envelope = fields(Buffer.from(options.body));
    const metadataField = envelope.find((field) => field.num === 1);
    const metadata = fields(metadataField.value);
    advertisedVersion = metadata.find((field) => field.num === 2)?.value.toString("utf8");
    return new Response(encodeMessage(1, Buffer.from("eyJtest.jwt")));
  });

  const minted = await mintUserJwt(
    "synthetic-key",
    "https://devin.invalid",
    undefined,
    "3.10.35",
  );

  assert.equal(minted.jwt, "eyJtest.jwt");
  assert.equal(advertisedVersion, "3.10.35");
});
