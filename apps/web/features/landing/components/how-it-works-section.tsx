"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import { cn } from "@multica/ui/lib/utils";
import { useAuthStore } from "@multica/core/auth";
import { docsHrefForLocale, useLocale } from "../i18n";
import { useDashboardCtaHref } from "../utils/use-dashboard-cta";
import { GitHubMark, GuideRails, githubUrl } from "./shared";

// Tints for steps 2–4; step 1 is the dark lead card.
const STEP_TINTS = ["bg-[#f4f2ee]", "bg-[#edf2fd]", "bg-[#fdf1e8]"];

export function HowItWorksSection() {
  const { t, locale } = useLocale();
  const user = useAuthStore((s) => s.user);
  const ctaHref = useDashboardCtaHref();
  const [first, ...rest] = t.howItWorks.steps;

  return (
    <section id="how-it-works" className="relative bg-white text-[#0a0d12]">
      <GuideRails />

      <div className="relative px-3 py-28 sm:px-6 sm:py-36 lg:px-10">
        <div className="mx-auto max-w-[1280px]">
          <h2 className="landing-display text-center text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[3.5rem] lg:text-[4rem]">
            {t.howItWorks.headlineMain}
            <br />
            <span className="text-[#0a0d12]/40">{t.howItWorks.headlineFaded}</span>
          </h2>

          <div className="mt-14 grid gap-3 lg:grid-cols-3">
            {first ? (
              <div className="relative flex flex-col overflow-hidden rounded-[32px] bg-[#10142a] p-8 text-white lg:row-span-2 lg:p-10">
                <MulticaIcon
                  className="pointer-events-none absolute -right-10 -top-10 size-56 text-white/[0.06]"
                  noSpin
                />
                <StepNumber index={0} className="text-[#d7f36b]" />
                <h3 className="mt-5 text-display-sm font-semibold tracking-[-0.02em]">
                  {first.title}
                </h3>
                <p className="mt-3 text-body-lg leading-[1.6] text-white/64">
                  {first.description}
                </p>

                <div className="mt-auto flex flex-col gap-2 pt-10">
                  <Link
                    href={ctaHref}
                    className="group inline-flex h-12 items-center justify-between rounded-[14px] bg-white px-5 text-body-lg font-semibold text-[#0a0d12] transition-colors hover:bg-white/90"
                  >
                    {user ? t.header.dashboard : t.howItWorks.cta}
                    <ArrowRight
                      className="size-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      href={docsHrefForLocale(locale)}
                      className="inline-flex h-11 items-center justify-center rounded-[14px] bg-white/10 px-4 text-body font-medium text-white transition-colors hover:bg-white/16"
                    >
                      {t.howItWorks.ctaDocs}
                    </Link>
                    <Link
                      href={githubUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-[14px] bg-white/10 px-4 text-body font-medium text-white transition-colors hover:bg-white/16"
                    >
                      <GitHubMark className="size-4" />
                      {t.howItWorks.ctaGithub}
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}

            {rest.map((step, i) => (
              <div
                key={step.title}
                className={cn(
                  "rounded-[32px] p-8 lg:p-10",
                  STEP_TINTS[i],
                  i === 0 && "lg:col-span-2",
                )}
              >
                <div
                  className={cn(
                    i === 0 && "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)] lg:gap-10",
                  )}
                >
                  <div>
                    <StepNumber index={i + 1} className="text-[#0a0d12]/36" />
                    <h3 className="mt-5 text-title-lg font-semibold tracking-[-0.01em]">
                      {step.title}
                    </h3>
                    <p className="mt-3 text-body leading-[1.65] text-[#0a0d12]/64">
                      {step.description}
                    </p>
                  </div>
                  {i === 0 ? <SetupTerminal /> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StepNumber({ index, className }: { index: number; className?: string }) {
  return (
    <span
      className={cn(
        "block text-label font-semibold tabular-nums tracking-[0.08em]",
        className,
      )}
    >
      {String(index + 1).padStart(2, "0")}
    </span>
  );
}

/** Decorative `multica setup` session beside the CLI step. */
function SetupTerminal() {
  return (
    <div
      aria-hidden
      className="mt-6 self-end rounded-[18px] bg-[#10142a] p-4 font-mono text-caption leading-[1.8] text-white/72 lg:mt-0"
    >
      <p>
        <span className="text-[#d7f36b]">$</span> multica setup
      </p>
      <p className="text-white/48">Signing in... done</p>
      <p className="text-white/48">Starting daemon... done</p>
      <p>
        <span className="text-[#7ee2a8]">✓</span> Claude Code
      </p>
      <p>
        <span className="text-[#7ee2a8]">✓</span> Codex
      </p>
      <p>
        <span className="text-[#7ee2a8]">✓</span> Cursor
      </p>
    </div>
  );
}
