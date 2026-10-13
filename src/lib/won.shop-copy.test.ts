/**
 * Shop-copy scheduling gate (Karmel). Run: npx tsx --test src/lib/won.shop-copy.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyHandoff, renderHandoff, shopDepositChecklistLine, todos, type Handoff } from "./won";

const LEAD = { name: "Ada Larson", email: "ada@example.com", phone: "801-555-0100", address: "12 Oak St, Provo UT" };
const FOOTER = "(Pricing and payment details are kept with admin and are not included in the shop copy.)";
const PREP = "☐ Prep to Schedule -- $1000 down payment collected";
const HOLD = "☐ Down payment not yet collected -- hold scheduling";
const DOLLARS = /\$\s?\d[\d,]*(?:\.\d+)?k?/gi;

function shopProject(deposit?: string): Handoff {
  const h = emptyHandoff("Karmel", { phone: LEAD.phone, email: LEAD.email, address: LEAD.address });
  h.branch = "shop";
  h.piano = { serial: "21174", label: "1928 Steinway M", note: "sticky B4" };
  h.price = { v: "$14,500", note: "includes delivery $350" };
  h.items = {
    track: { v: "Rebuild" },
    payment: { v: "milestones" },
    received: { note: "$2,000 card 10/7" },
    invoice: { v: "admin" },
    service: { note: "pedal squeak" },
  };
  h.notes = "Balance due is $12,500 after the deposit.";
  if (deposit) h.items.deposit = { v: deposit, note: "cash at the handshake" };
  return h;
}

function dollars(body: string): string[] {
  return body.match(DOLLARS) || [];
}

describe("shop deposit scheduling line", () => {
  it("uses the wizard queue-deposit answer and no other signal", () => {
    const collected = shopProject("collected");
    const assigned = shopProject("admin");
    assert.equal(shopDepositChecklistLine(collected), "Prep to Schedule -- $1000 down payment collected");
    assert.equal(shopDepositChecklistLine(assigned), "Down payment not yet collected -- hold scheduling");
    assert.equal(shopDepositChecklistLine(shopProject()), "Down payment not yet collected -- hold scheduling");
    assert.equal(shopDepositChecklistLine(shopProject("nd")), "Down payment not yet collected -- hold scheduling");
    const showroom = emptyHandoff("Brigham");
    showroom.items.payment = { v: "deposit" };
    assert.equal(shopDepositChecklistLine(showroom), null);
  });

  it("renders the prep line when the $1000 queue deposit is collected", () => {
    const h = shopProject("collected");
    const shop = renderHandoff(h, LEAD, {}, undefined, "shop");
    const admin = renderHandoff(h, LEAD, {}, undefined, "admin");

    assert.ok(shop.body.includes(`SHOP MANAGER TO-DO (Mark):\n  ${PREP}`));
    assert.equal(shop.body.includes("hold scheduling"), false);
    assert.equal(dollars(shop.body).join(","), "$1000");
    assert.ok(shop.body.endsWith(FOOTER));
    assert.equal(shop.body.split(FOOTER).length - 1, 1);
    assert.doesNotMatch(shop.body, /\$14,500|\$2,000|\$12,500|\$350|\$1,000/);
    assert.doesNotMatch(shop.body, /MONEY:|PRICE:|cash at the handshake|milestones|Received so far|Queue deposit/i);

    assert.doesNotMatch(admin.body, /Prep to Schedule|hold scheduling/);
    assert.match(admin.body, /PRICE: \$14,500/);
    assert.match(admin.body, /\$1,000 queue deposit: Collected — cash at the handshake/);
    const adminShop = admin.body.split("SHOP MANAGER TO-DO (Mark):\n")[1].split("\n\n")[0];
    assert.equal(adminShop, todos(h).shop.map((x) => `  ☐ ${x}`).join("\n"));
  });

  it("tells Mark to hold when the deposit is not collected", () => {
    for (const deposit of [undefined, "admin", "nd"] as const) {
      const h = deposit ? shopProject(deposit) : shopProject();
      const shop = renderHandoff(h, LEAD, {}, undefined, "shop");
      const admin = renderHandoff(h, LEAD, {}, undefined, "admin");

      assert.ok(shop.body.includes(`SHOP MANAGER TO-DO (Mark):\n  ${HOLD}`));
      assert.equal(shop.body.includes("Prep to Schedule"), false);
      assert.deepEqual(dollars(shop.body), []);
      assert.ok(shop.body.endsWith(FOOTER));
      assert.doesNotMatch(shop.body, /\$14,500|\$2,000|\$12,500|\$350|\$1,000/);
      assert.doesNotMatch(admin.body, /Prep to Schedule|hold scheduling/);
      assert.match(admin.body, /PRICE: \$14,500/);
    }
  });

  it("leaves a showroom shop copy without the $1000 line", () => {
    const h = emptyHandoff("Brigham", { phone: LEAD.phone, email: LEAD.email, address: LEAD.address });
    h.piano = { serial: "100", label: "Hailun HG178" };
    h.price = { v: "$8,900" };
    h.items.payment = { v: "deposit", note: "$1000 down" };
    const shop = renderHandoff(h, LEAD, {}, undefined, "shop");
    assert.doesNotMatch(shop.body, /Prep to Schedule|hold scheduling|\$1000|\$8,900/);
    assert.ok(shop.body.endsWith(FOOTER));
  });
});
