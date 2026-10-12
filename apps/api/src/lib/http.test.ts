import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { breakerState, resetBreakers, resilientFetch } from "./http";

let hits = 0;
let mode: "flaky" | "down" | "slow" | "ok" = "ok";
const server = createServer((_req, res) => {
  hits++;
  if (mode === "flaky" && hits < 3) return res.writeHead(503).end();
  if (mode === "down") return res.writeHead(502).end();
  if (mode === "slow") return void setTimeout(() => res.end("late"), 300);
  res.end("ok");
});
let url = "";
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(() => void server.close());
beforeEach(() => {
  hits = 0;
  resetBreakers();
});

describe("resilientFetch", () => {
  it("retries a GET through transient 503s", async () => {
    mode = "flaky";
    const res = await resilientFetch(url);
    expect(await res.text()).toBe("ok");
    expect(hits).toBe(3);
  });
  it("does not repeat a non-idempotent POST", async () => {
    mode = "flaky";
    const res = await resilientFetch(url, { method: "POST" });
    expect(res.status).toBe(503);
    expect(hits).toBe(1);
  });
  it("times out slow calls", async () => {
    mode = "slow";
    await expect(resilientFetch(url, { timeoutMs: 50, retries: 0 })).rejects.toThrow(/unreachable/);
  });
  it("opens the circuit after repeated failures and fails fast", async () => {
    mode = "down";
    for (let i = 0; i < 5; i++) await resilientFetch(url, { retries: 0, service: "test" }).catch(() => undefined);
    expect(breakerState("test").open).toBe(true);
    const before = hits;
    await expect(resilientFetch(url, { service: "test" })).rejects.toThrow(/circuit open/);
    expect(hits).toBe(before);
  });
});
