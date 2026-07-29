import type { ProjectSnapshot } from "@/lib/project/snapshot";
import { LocalAssistant } from "./local";
import type { AssistantAnswer, AssistantProvider } from "./types";

/**
 * AI provider adapter.
 *
 * The application ships with a fully functional local rules engine. An
 * external model can be plugged in by setting ASSISTANT_PROVIDER and the
 * matching API key in the environment — keys are read server-side only and
 * never sent to the browser.
 *
 * Adding a provider means implementing AssistantProvider and registering it in
 * `resolveProvider` below. Nothing else in the application changes.
 */

const SYSTEM_PROMPT = `You are the engineering assistant inside GliderForge Assistant, a workspace for a senior-design project building a small autonomous underwater glider with a motor-driven syringe buoyancy engine.

Hard rules:
- Never invent measurements, material properties, component specifications, test data or citations. If a number is not in the supplied project context, say it is missing.
- Always state which project values you used, quoting them with units.
- Separate calculated results from qualitative advice.
- Never present a recommendation as a verified engineering result.
- Never claim an uploaded file contains information that the context does not show was extracted from it.
- Flag any safety-relevant conclusion (pressure housing, sealing, battery, recovery) as requiring human review.
- Do not propose changes to project data as though they were already applied; describe them as proposals.
- Buoyancy-engine architectures are not interchangeable. A syringe that changes external displaced volume, one that takes water into the vehicle, one that inflates an external bladder, and one that moves a piston separating internal and external fluids behave differently in sign and in vehicle mass. Use the architecture given in the context.`;

function buildContext(snap: ProjectSnapshot): string {
  const v = (q: { value: number; unit: string } | undefined) =>
    q && Number.isFinite(q.value) ? `${q.value.toPrecision(5)} ${q.unit}` : "not available";
  return JSON.stringify(
    {
      project: { name: snap.project.name, phase: snap.project.phase, isSample: !!snap.project.is_sample },
      completionPercent: Number(snap.completion.percent.toFixed(1)),
      water: { densityKgM3: snap.water.densitySI, source: snap.water.source },
      massProperties: {
        totalMass: v(snap.massProps.values.totalMass),
        totalDisplacedVolume: v(snap.massProps.values.totalDisplacedVolume),
        cg: snap.massProps.cg,
        cb: snap.massProps.cb,
        missingMass: snap.massProps.missingMass,
        missingVolume: snap.massProps.missingVolume,
      },
      buoyancy: {
        buoyantForce: v(snap.buoyancy.values.buoyantForce),
        weight: v(snap.buoyancy.values.weight),
        netBuoyantForce: v(snap.buoyancy.values.netBuoyantForce),
        ballastToNeutralKg: snap.neutral.massChangeSI,
      },
      stability: {
        verticalSeparation: v(snap.stability.values.verticalSeparation),
        longitudinalSeparation: v(snap.stability.values.longitudinalSeparation),
        equilibriumPitchDeg: (snap.stability.values.equilibriumPitch.value * 180) / Math.PI,
      },
      buoyancyEngine: {
        architecture: snap.settings.syringe.config,
        boreMm: snap.settings.syringe.boreDiameterSI * 1000,
        usableStrokeMm: snap.settings.syringe.usableStrokeSI * 1000,
        sweptVolumeCm3: snap.syringe.values.usableVolumeChange.value * 1e6,
        buoyancyChangeN: snap.syringe.values.buoyancyForceChange.value,
        requiredMotorTorqueNm: snap.syringe.values.requiredMotorTorque?.value ?? null,
        stallMargin: snap.syringe.values.stallMargin?.value ?? null,
        frictionEntered: snap.settings.syringe.frictionForceSI !== undefined,
      },
      hydrodynamics: {
        coefficientSource: snap.settings.hydro.coefficientSource,
        CL: snap.settings.hydro.liftCoefficient,
        CD: snap.settings.hydro.dragCoefficient,
        diveSpeedMS: snap.diveGlide.values.speed.value,
        glideRatio: snap.diveGlide.values.glideRatio.value,
      },
      power: {
        averagePowerW: snap.power.values.averagePower.value,
        enduranceHours: snap.power.values.enduranceTime.value / 3600,
      },
      counts: {
        components: snap.components.length,
        requirements: snap.requirements.length,
        requirementsVerified: snap.completion.requirementsVerified,
        risks: snap.risks.length,
        openRisks: snap.completion.openRisks,
        tests: snap.tests.length,
        testRuns: snap.testRuns.length,
        decisions: snap.decisions.length,
        openAssumptions: snap.completion.openAssumptions,
        geometryFiles: snap.geometryFiles.length,
      },
      requirements: snap.requirements.slice(0, 40).map((r) => ({
        key: r.key,
        title: r.title,
        target: r.target_value,
        unit: r.target_unit,
        status: r.verification_status,
        method: r.verification_method,
      })),
      openAssumptions: snap.assumptions
        .filter((x) => String(x.status) === "open")
        .slice(0, 25)
        .map((x) => ({ text: x.text, basis: x.basis, criticality: x.criticality })),
      activeWarnings: snap.warnings
        .filter((w) => w.warning.severity !== "info")
        .slice(0, 40)
        .map((w) => `[${w.module}/${w.warning.severity}] ${w.warning.message}`),
    },
    null,
    1,
  );
}

class AnthropicAssistant implements AssistantProvider {
  readonly name = "anthropic";
  readonly available: boolean;
  private readonly model: string;

  constructor() {
    this.available = Boolean(process.env.ANTHROPIC_API_KEY);
    this.model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  }

  async answer(
    question: string,
    snap: ProjectSnapshot,
    history: { role: string; content: string }[],
  ): Promise<AssistantAnswer> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not configured.");

    const messages = [
      ...history.slice(-8).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      {
        role: "user" as const,
        content: `PROJECT CONTEXT (the only data you may treat as factual):\n\`\`\`json\n${buildContext(snap)}\n\`\`\`\n\nQUESTION: ${question}`,
      },
    ];

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // Never echo the key or full headers into an error surfaced to the user.
      throw new Error(`Assistant provider request failed with HTTP ${res.status}. ${detail.slice(0, 300)}`);
    }
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (json.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();

    return {
      answer: text || "The provider returned an empty response.",
      calculations: [],
      advice: [
        "This answer came from an external language model given the project context shown in the citations. Unlike the built-in rules engine it is not deterministic — verify any number it states against the module that owns it.",
      ],
      citations: [
        {
          label: "Project context supplied to the model",
          value: `${snap.components.length} components, ${snap.requirements.length} requirements, ${snap.testRuns.length} test runs`,
          source: "Live project snapshot, sent server-side only",
        },
      ],
      missingData: [],
      safetyFlag: /pressure|housing|seal|battery|depth limit|recover/i.test(text),
      provider: `anthropic:${this.model}`,
      intent: "llm",
    };
  }
}

export function resolveProvider(): AssistantProvider {
  const configured = (process.env.ASSISTANT_PROVIDER || "local").toLowerCase();
  if (configured === "anthropic") {
    const p = new AnthropicAssistant();
    if (p.available) return p;
  }
  return new LocalAssistant();
}

export function providerStatus(): { name: string; configured: boolean; note: string } {
  const configured = (process.env.ASSISTANT_PROVIDER || "local").toLowerCase();
  if (configured === "anthropic") {
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
    return {
      name: hasKey ? "anthropic" : "local-rules (fallback)",
      configured: hasKey,
      note: hasKey
        ? "An external model is configured. Its answers are not deterministic — verify numbers against the owning module."
        : "ASSISTANT_PROVIDER is set to 'anthropic' but ANTHROPIC_API_KEY is missing, so the built-in rules engine is being used.",
    };
  }
  return {
    name: "local-rules",
    configured: true,
    note: "Deterministic built-in assistant. Answers come from your project data only. Set ASSISTANT_PROVIDER=anthropic with an API key for free-form answers.",
  };
}

export { buildContext, SYSTEM_PROMPT };
