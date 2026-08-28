import test from "node:test";
import assert from "node:assert/strict";
import {
  chat, tokenFloorFor, SarvamError,
  MIN_ANSWER_TOKENS, MIN_ANSWER_TOKENS_INDIC, CHAT_MODELS, DEFAULT_CHAT_MODEL, isReasoningModel,
} from "./sarvam.ts";

/** Swap global fetch for one call, always restoring it. */
async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

const completion = (over: Record<string, unknown> = {}) => ({
  choices: [{ finish_reason: "stop", message: { content: "answer", tool_calls: null }, ...over }],
  usage: { completion_tokens: 120 },
});

test("sarvam-m is not offered — it is deprecated upstream", () => {
  assert.ok(!(CHAT_MODELS as readonly string[]).includes("sarvam-m"));
  assert.ok((CHAT_MODELS as readonly string[]).includes("sarvam-105b"));
  assert.ok((CHAT_MODELS as readonly string[]).includes("sarvam-105b-conversations"));
});

test("the default model is the non-reasoning one", () => {
  // sarvam-105b bills a long reasoning trace nobody sees: measured 3,321
  // completion tokens across six probes where the conversations model spent
  // 139, for identical answers and identical refusals. See sarvam.ts.
  assert.equal(DEFAULT_CHAT_MODEL, "sarvam-105b-conversations");
  assert.equal(isReasoningModel(DEFAULT_CHAT_MODEL), false, "the default must not bill a hidden trace");
  assert.equal(isReasoningModel("sarvam-105b"), true);
});

test("token floor is higher for Indic scripts than Latin", () => {
  assert.equal(tokenFloorFor("Which century was this built?"), MIN_ANSWER_TOKENS);
  assert.equal(tokenFloorFor("தஞ்சாவூர் கோவில்"), MIN_ANSWER_TOKENS_INDIC);
  assert.equal(tokenFloorFor("काशी विश्वनाथ"), MIN_ANSWER_TOKENS_INDIC);
  assert.ok(MIN_ANSWER_TOKENS_INDIC > MIN_ANSWER_TOKENS);
});

test("authenticates with api-subscription-key, never a Bearer token", async () => {
  let seen: Record<string, string> = {};
  await withFetch(async (_u, init) => {
    seen = (init?.headers ?? {}) as Record<string, string>;
    return ok(completion());
  }, () => chat({ apiKey: "K", messages: [{ role: "user", content: "hi" }] }));

  assert.equal(seen["api-subscription-key"], "K");
  assert.ok(!("Authorization" in seen), "must not send an Authorization header");
});

test("a reasoning-truncated reply is retried with a bigger budget, not surfaced", async () => {
  const budgets: number[] = [];
  const result = await withFetch(async (_u, init) => {
    const body = JSON.parse(String(init?.body));
    budgets.push(body.max_tokens);
    // First call: reasoning consumed everything — content null, finish_reason length.
    if (budgets.length === 1) {
      return ok(completion({ finish_reason: "length", message: { content: null, tool_calls: null } }));
    }
    return ok(completion());
  }, () => chat({ apiKey: "K", messages: [{ role: "user", content: "தமிழ்" }], maxTokens: 600 }));

  assert.equal(budgets.length, 2, "should retry exactly once");
  assert.ok(budgets[1] > budgets[0], `retry must raise the budget (${budgets[0]} -> ${budgets[1]})`);
  assert.equal(result.content, "answer");
  assert.equal(result.truncated, false);
});

test("the retry happens at most once, and truncation is reported rather than faked", async () => {
  let calls = 0;
  const result = await withFetch(async () => {
    calls += 1;
    return ok(completion({ finish_reason: "length", message: { content: null, tool_calls: null } }));
  }, () => chat({ apiKey: "K", messages: [{ role: "user", content: "hi" }], maxTokens: 600 }));

  assert.equal(calls, 2, "one retry, then give up");
  assert.equal(result.truncated, true, "caller must be able to tell this was truncation");
  assert.equal(result.content, null, "must NOT invent content to fill the gap");
});

test("tool calls survive and are not mistaken for truncation", async () => {
  const toolCall = {
    id: "call_1", type: "function",
    function: { name: "findSites", arguments: '{"place":"Thanjavur"}' },
  };
  const result = await withFetch(
    async () => ok(completion({ finish_reason: "tool_calls", message: { content: null, tool_calls: [toolCall] } })),
    () => chat({ apiKey: "K", messages: [{ role: "user", content: "near Thanjavur" }] }),
  );
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].function.name, "findSites");
  assert.equal(result.truncated, false, "a tool call is a complete turn, not a truncated one");
});

test("the tools array is omitted entirely when there are none", async () => {
  let body: Record<string, unknown> = {};
  await withFetch(async (_u, init) => {
    body = JSON.parse(String(init?.body));
    return ok(completion());
  }, () => chat({ apiKey: "K", messages: [{ role: "user", content: "hi" }] }));
  assert.ok(!("tools" in body), "an empty tools key confuses some gateways");
});

test("an API error surfaces the upstream message and status", async () => {
  await withFetch(
    async () => new Response(
      JSON.stringify({ error: { message: "Model 'sarvam-m' has been deprecated.", request_id: "r1" } }),
      { status: 400 },
    ),
    async () => {
      await assert.rejects(
        () => chat({ apiKey: "K", messages: [{ role: "user", content: "hi" }] }),
        (e: unknown) => {
          assert.ok(e instanceof SarvamError);
          assert.equal(e.status, 400);
          assert.match(e.message, /deprecated/);
          assert.equal(e.requestId, "r1");
          return true;
        },
      );
    },
  );
});

test("completion tokens are reported, since reasoning tokens are billed", async () => {
  const result = await withFetch(
    async () => ok({ ...completion(), usage: { completion_tokens: 940 } }),
    () => chat({ apiKey: "K", messages: [{ role: "user", content: "hi" }] }),
  );
  assert.equal(result.completionTokens, 940);
});
