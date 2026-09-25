import { describe, expect, it } from "vitest";
import { assertPublicHttpsUrl } from "./safe-url";

describe("assertPublicHttpsUrl", () => {
  it("rejects non-https and private hosts", async () => {
    await expect(assertPublicHttpsUrl("http://example.com/a.jpg")).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://localhost/a.jpg")).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://127.0.0.1/a.jpg")).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://10.1.2.3/a.jpg")).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://[::1]/a.jpg")).rejects.toThrow();
  });
  it("accepts public ip literals", async () => {
    await expect(assertPublicHttpsUrl("https://8.8.8.8/a.jpg")).resolves.toBeInstanceOf(URL);
  });
});
