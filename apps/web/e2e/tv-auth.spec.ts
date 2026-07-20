import { expect, test } from "@playwright/test";

const tvPayload = {
  generatedAt: new Date().toISOString(),
  metrics: {
    open: 12,
    breaching: 1,
    atRisk: 2,
    unassigned: 1,
    waitingOnTech: 3,
    customerReply: 2,
    unackedReplies: 2,
    openedToday: 4,
    resolvedToday: 5,
  },
  statusCounts: [{ status: "Waiting on Tech", count: 3, breaching: 0 }],
  breaches: [],
  atRisk: [],
  unassignedTickets: [],
  oldestTickets: [],
  customerReplyTickets: [],
  techStats: [],
  wallOfShame: [],
  wallOfFame: [],
  scoreboard: [],
  haloBaseUrl: "https://example.invalid",
  dispatch: { techs: [] },
};

test("redeems a fragment code without exposing it to the command API", async ({ page }) => {
  const sessionBodies: unknown[] = [];
  const commandUrls: string[] = [];

  await page.route("**/api/tv/session", async (route) => {
    if (route.request().method() === "POST") {
      sessionBodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "approval required" }) });
  });
  await page.route("**/api/tv/command", async (route) => {
    commandUrls.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(tvPayload) });
  });

  await page.goto("/tv#code=ABCD-EFGH");

  await expect(page.getByText("Open Tickets")).toBeVisible();
  await expect(page).toHaveURL(/\/tv$/);
  expect(sessionBodies).toEqual([{ code: "ABCD-EFGH" }]);
  expect(commandUrls).toHaveLength(1);
  expect(commandUrls[0]).not.toContain("ABCD-EFGH");
  expect(commandUrls[0]).not.toContain("key=");
});

test("shows secure QR pairing when the TV has no approved session", async ({ page }) => {
  await page.route("**/api/tv/session", async (route) => {
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "approval required" }) });
  });
  await page.route("**/api/tv/pairing", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          requestId: "request-1",
          secret: "pair-secret",
          approvalUrl: "http://localhost:3100/tv/approve?id=request-1&secret=pair-secret",
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          detectedIp: "203.0.113.5",
        }),
      });
      return;
    }
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ approved: false }) });
  });

  await page.goto("/tv");

  await expect(page.getByText("Scan to approve this TV from an authenticated TriageIT admin account.")).toBeVisible();
  await expect(page.getByText("one-time access code")).toBeVisible();
  await expect(page.getByPlaceholder("ABCD-EFGH")).toHaveAttribute("type", "password");
});
