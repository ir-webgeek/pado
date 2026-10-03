import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, signState, unwrap, verifyState } from "./oauth-state";

describe("instagram oauth", () => {
  it("unwraps both documented response shapes", () => {
    expect(unwrap<{ user_id: string }>({ data: [{ user_id: "17841" }] }).user_id).toBe("17841");
    expect(unwrap<{ user_id: string }>({ user_id: "17841" }).user_id).toBe("17841");
  });
  it("builds the authorize URL with code flow, scopes and state", () => {
    const u = new URL(buildAuthorizeUrl("990602627938098", "https://shop.example/api/v1/instagram/oauth/callback", ["instagram_business_basic", "instagram_business_manage_messages"], "abc"));
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("state")).toBe("abc");
    expect(u.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_manage_messages");
  });
  it("state round-trips and rejects tampering, other secrets and expiry", () => {
    const secret = "x".repeat(40);
    const s = signState(secret, { shopId: "shop-1", userId: "user-1", nonce: "n1" }, 60_000, 1_000);
    expect(verifyState(secret, s, 2_000)).toMatchObject({ shopId: "shop-1", userId: "user-1", nonce: "n1" });
    expect(verifyState("y".repeat(40), s, 2_000)).toBeNull();
    expect(verifyState(secret, s, 70_000)).toBeNull();
    const [body, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), shopId: "shop-2" })).toString("base64url");
    expect(verifyState(secret, `${forged}.${sig}`, 2_000)).toBeNull();
  });
});
