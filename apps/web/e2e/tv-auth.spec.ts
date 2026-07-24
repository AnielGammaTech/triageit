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
  schedule: {
    saturdaySupport: {
      technician: "Jonathan",
      subject: "Saturday Support - Jonathan",
      startsAt: "2026-07-25T12:00:00Z",
      endsAt: "2026-07-25T21:00:00Z",
    },
  },
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
  const saturdaySupport = page.getByTestId("saturday-support-card");
  await expect(saturdaySupport).toBeVisible();
  await expect(saturdaySupport).toContainText("Saturday Support");
  await expect(saturdaySupport).toContainText("Jonathan");
  await expect(saturdaySupport).toContainText("SAT, JUL 25");
  await expect(saturdaySupport).toContainText("8:00 AM–5:00 PM ET");
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

test("shows a read-only technician score equation on the wallboard", async ({ page }) => {
  await page.addInitScript(() => {
    Date.now = () => 10_000;
  });
  await page.route("**/api/tv/session", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "approval required" }) });
  });
  await page.route("**/api/tv/command", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...tvPayload,
        scoreboard: [{
          tech: "Ryan Fitzpatrick",
          score: -1.5,
          good: 2,
          needs: 4,
          poor: 0,
          emails: 5,
          breaching: 0,
          unacked: 0,
          reviewPoints: -4,
          emailPoints: 2.5,
          positiveReviewPoints: 2,
          responsePenaltyPoints: 6,
          slaPenaltyPoints: 0,
          replyPenaltyPoints: 0,
          scheduleDeferrablePenaltyPoints: 0,
          livePenaltyDeferred: 0,
          scheduleState: "available",
          scheduleReason: null,
          evidence: {
            emails: [{
              halo_id: 41570,
              occurredAt: "2026-07-23T14:25:00Z",
              label: "Customer email sent",
              points: 0.5,
            }],
            reviews: [{
              halo_id: 41570,
              occurredAt: "2026-07-23T15:00:00Z",
              rating: "good",
              maxGapHours: 1.35,
              summary: "Customer-visible response timing verified.",
              positivePoints: 1,
              delayPenaltyPoints: 0,
              points: 1,
            }, {
              halo_id: 40999,
              occurredAt: "2026-07-22T15:00:00Z",
              rating: "needs_improvement",
              maxGapHours: 11.3,
              summary: "Verified response delay.",
              positivePoints: 0,
              delayPenaltyPoints: 3,
              points: -3,
            }],
            live: [],
          },
        }],
      }),
    });
  });

  await page.goto("/tv#code=ABCD-EFGH");

  const scoreRow = page.getByTestId("tv-score-row-Ryan-Fitzpatrick");
  await expect(scoreRow).toBeVisible();
  await expect(scoreRow).toContainText("+2.5 email (5 sent) · +2 reviews · −6 delays");
  await expect(scoreRow).not.toHaveAttribute("role", "button");
  await expect(page.getByText("click to audit")).toHaveCount(0);
  await expect(page.getByTestId("command-score-audit")).toHaveCount(0);
});
