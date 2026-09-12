import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.use({ screenshot: "off" });
test("prompt opens a saved interview, accepts agent questions, and approves an editable manual scope", async ({
  page,
  baseURL,
}, testInfo) => {
  const headers = { Origin: baseURL! };
  const registration = await page.request.post("/api/auth/register", {
    headers,
    data: {
      email: `brief-${randomUUID()}@studio.test`,
      name: "Brief workflow verification",
      password: randomUUID() + randomUUID(),
    },
  });
  expect(registration.status()).toBe(201);
  await page.goto("/");
  const request = "A welcoming website for a neighborhood book exchange";
  await page.getByLabel("Describe your design").fill(request);
  await page.getByRole("button", { name: "Let's create" }).click();
  await expect(
    page.getByRole("heading", { name: "What should we make together?" }),
  ).toBeVisible();
  const id = new URL(page.url()).searchParams.get("project");
  expect(id).toBeTruthy();
  const route = `/api/projects/${id}/brief`;
  try {
    let brief = (await (await page.request.get(route)).json()).brief;
    expect(brief.request).toBe(request);
    expect(brief.status).toBe("interview");
    await expect(
      page.getByRole("button", { name: "Ask AI to start the interview" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Connect your AI provider" }),
    ).toBeVisible();

    // A person or connected agent can author real questions through the public brief contract.
    const questions = [
      {
        id: "constructor",
        title: "Who is the book exchange for?",
        description: "Choose the main audience.",
        type: "single",
        options: ["Neighbors", "Schools"],
        required: true,
      },
      {
        id: "sections",
        title: "Which sections should it include?",
        description: "Choose any that apply.",
        type: "multiple",
        options: ["How it works", "Upcoming events", "Our story"],
        required: true,
      },
      {
        id: "tone",
        title: "How should it feel?",
        description: "A short description is enough.",
        type: "text",
        options: [],
        required: false,
      },
    ];
    const authored = await page.request.put(route, {
      headers,
      data: {
        expectedRevision: brief.revision,
        interview: {
          message: "Let us focus the audience and content before designing.",
          questions,
          scope: null,
        },
      },
    });
    expect(authored.status()).toBe(200);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Who is the book exchange for?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Neighbors", exact: true }).click();
    await page
      .getByRole("button", { name: "How it works", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Upcoming events", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "How should it feel?" })
      .fill("Warm and welcoming");
    let releaseResponse!: () => void, responseArrived!: () => void;
    const heldResponse = new Promise<void>(resolve => { releaseResponse = resolve; });
    const actualResponse = new Promise<void>(resolve => { responseArrived = resolve; });
    // Delay delivery of the real committed HTTP response to inspect the in-flight UI.
    await page.route(`**${route}`, async intercepted => {
      if (intercepted.request().method() !== 'PUT') { await intercepted.continue(); return; }
      const response = await intercepted.fetch();
      responseArrived();
      await heldResponse;
      await intercepted.fulfill({response});
    });
    await page
      .getByRole("button", { name: "Save answers", exact: true })
      .click();
    await actualResponse;
    try { await expect(page.getByLabel('Original request', {exact:true})).toBeDisabled(); }
    finally { releaseResponse(); }
    await expect(page.getByRole("status")).toContainText(
      "Your brief is saved.",
    );
    await page.unroute(`**${route}`);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Neighbors", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Upcoming events", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.screenshot({
      path: `plans/2026-09-07-bootstrap-design-studio-ai/reports/onboarding-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Write scope manually", exact: true })
      .click();
    await page
      .getByLabel("Audience", { exact: true })
      .fill("Neighbors who enjoy sharing books");
    await page
      .getByLabel("Visual direction", { exact: true })
      .fill(
        "Warm earth colors, welcoming headings, and a clear primary action",
      );
    await page
      .getByLabel("Deliverables", { exact: true })
      .fill("One landing page\nHow it works and upcoming events sections");
    await page
      .getByLabel("Acceptance criteria", { exact: true })
      .fill("Visitors can find where and when to exchange a book");
    await page
      .getByRole("button", { name: "Approve scope", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Ready to bring it to life." }),
    ).toBeVisible();
    brief = (await (await page.request.get(route)).json()).brief;
    expect(brief.status).toBe("approved");
    expect(brief.answers.constructor).toBe("Neighbors");
    expect(brief.answers.sections).toEqual(["How it works", "Upcoming events"]);
    await expect(
      page.getByRole("button", { name: "Generate design", exact: true }),
    ).toBeDisabled();

    await page
      .getByLabel("Audience", { exact: true })
      .fill("Families in the neighborhood");
    await expect(
      page.getByRole("button", { name: "Approve scope", exact: true }),
    ).toBeVisible();
    const concurrent = await page.request.put(route, {
      headers,
      data: {
        expectedRevision: brief.revision,
        request: request + " with family activities",
      },
    });
    expect(concurrent.status()).toBe(200);
    await page.getByRole("button", { name: "Save scope", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("The brief changed");
    await expect(page.getByLabel("Audience", { exact: true })).toHaveValue(
      "Families in the neighborhood",
    );
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Reload latest brief", exact: true })
      .click();
    await expect(page.getByLabel("Audience", { exact: true })).toHaveValue(
      "Neighbors who enjoy sharing books",
    );
    await page
      .getByRole("button", { name: "Open editor", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Continue design interview" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Design checks", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "This page has no visible content.",
    );
    await page
      .getByRole("button", { name: /This page has no visible content/ })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page
      .getByRole("button", { name: "Continue design interview" })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Appearance: System", exact: true })
      .click();
    await page
      .getByRole("menuitemradio", { name: "Dark", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  } finally {
    await page.request.delete(`/api/projects/${id}`, { headers });
  }
});
test("a configured text provider enables the AI interview and generation entries", async ({
  page,
  baseURL,
}) => {
  const headers = { Origin: baseURL! };
  const registration = await page.request.post("/api/auth/register", {
    headers,
    data: {
      email: `provider-gate-${randomUUID()}@studio.test`,
      name: "Provider gate verification",
      password: randomUUID() + randomUUID(),
    },
  });
  expect(registration.status()).toBe(201);
  // The E2E server reserves this allowlisted origin for settings persistence (scripts/run-e2e.mjs).
  const connection = await page.request.put(
    "/api/providers/custom-onboarding-text",
    {
      headers,
      data: {
        name: "Onboarding text",
        baseUrl: "https://browser-provider.example/v1",
        model: "onboarding-model",
        protocol: "openai",
        authMethod: "none",
      },
    },
  );
  expect(connection.status()).toBe(200);
  const projectResponse = await page.request.post("/api/projects", {
    headers,
    data: { name: "Provider gate" },
  });
  expect(projectResponse.status()).toBe(201);
  const id = (await projectResponse.json()).project.id as string;
  const route = `/api/projects/${id}/brief`;
  try {
    const created = await page.request.put(route, {
      headers,
      data: { expectedRevision: 0, request: "A provider-enabled brief" },
    });
    expect(created.status()).toBe(200);
    await page.goto(`/?project=${id}`);
    // The interview entry derives its disabled state from a configured text provider, not a fixed gate.
    const interviewButton = page.getByRole("button", {
      name: "Ask AI to start the interview",
    });
    await expect(interviewButton).toBeEnabled();
    const interviewRequest = page.waitForRequest(
      (request) =>
        request.url().includes(`/api/projects/${id}/brief/interview`) &&
        request.method() === "POST",
    );
    await interviewButton.click();
    expect((await interviewRequest).postDataJSON().provider).toBe(
      "custom-onboarding-text",
    );
    let brief = (await (await page.request.get(route)).json()).brief;
    const saved = await page.request.put(route, {
      headers,
      data: {
        expectedRevision: brief.revision,
        scope: {
          objective: "A provider-enabled brief",
          audience: "Neighbors",
          direction: "Warm and welcoming",
          deliverables: ["One landing page"],
          constraints: [],
          acceptanceCriteria: ["Visitors can find the exchange"],
        },
      },
    });
    expect(saved.status()).toBe(200);
    brief = (await saved.json()).brief;
    const approved = await page.request.post(`${route}/approve`, {
      headers,
      data: { expectedRevision: brief.revision },
    });
    expect(approved.status()).toBe(200);
    // An approved brief with a non-empty default document opens the editor; `brief=open` keeps the
    // approved scope workspace on screen so the generation entry is observable.
    await page.goto(`/?project=${id}&brief=open`);
    await expect(
      page.getByRole("button", { name: "Generate design", exact: true }),
    ).toBeEnabled();
  } finally {
    await page.request.delete(`/api/projects/${id}`, { headers });
    await page.request.delete("/api/providers/custom-onboarding-text", {
      headers,
    });
  }
});
