"use client";

import { Fragment } from "react";
import Link from "next/link";
import { ArrowUpRight, Bot } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import { docsHrefForLocale, useLocale } from "../i18n";
import { formatStarCount, useGithubStars } from "../utils/use-github-stars";
import { HERO_PROVIDERS, type HeroProvider } from "./provider-marks";
import { GitHubMark, githubUrl } from "./shared";

/**
 * Bento wall under the hero. Every tile is a verifiable fact — a supported
 * runtime, the live star count, the detected-tool count, a product event — so
 * the wall reads as proof without inventing customer logos or quotes.
 */
export function ProofSection() {
  const { t, locale } = useLocale();
  const stars = useGithubStars();
  const proof = t.home.proof;
  const selfHost = t.openSource.highlights[0];

  return (
    <section className="relative z-10 -mt-24 px-3 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1280px] rounded-[40px] bg-[#f4f2ee] px-4 py-14 sm:px-8 lg:px-12 lg:py-20">
        <p className="mx-auto max-w-[760px] text-balance text-center text-title-lg text-[#0a0d12]/72 sm:text-[1.625rem] sm:leading-[1.4]">
          <Emphasis text={proof.headline} />
        </p>

        <div className="mt-12 grid auto-rows-[minmax(96px,auto)] grid-flow-row-dense grid-cols-2 gap-3 sm:grid-cols-6 lg:grid-cols-12">
          <ProviderTile name="Claude Code" className="sm:col-span-2 lg:col-span-3" large />
          <ProviderTile name="Codex" />

          <Link
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(
              tileClassName,
              "group col-span-2 flex flex-col justify-between p-5 sm:col-span-3 lg:col-span-3 lg:row-span-2",
            )}
          >
            <span className="flex items-center justify-between text-[#0a0d12]/60">
              <GitHubMark className="size-6 text-[#0a0d12]" />
              <TileArrow />
            </span>
            <span className="mt-6 block">
              <span className="block text-[3rem] font-semibold leading-none tracking-[-0.04em] text-[#0a0d12] tabular-nums lg:text-[3.5rem]">
                {stars != null ? formatStarCount(stars) : "GitHub"}
              </span>
              <span className="mt-2 block text-caption font-semibold uppercase tracking-[0.12em] text-[#0a0d12]/60">
                {stars != null ? proof.starsLabel : t.openSource.cta}
              </span>
            </span>
          </Link>

          <ProviderTile name="Cursor" />
          <ProviderTile name="GitHub Copilot" />

          <Link
            href={`${docsHrefForLocale(locale)}/providers`}
            className={cn(
              tileClassName,
              "group col-span-2 flex items-center justify-between gap-4 px-5 py-4 sm:col-span-3 lg:col-span-3",
            )}
          >
            <span className="flex items-center gap-3">
              <span className="text-[2.5rem] font-semibold leading-none tracking-[-0.04em] text-[#0a0d12] tabular-nums">
                {proof.toolsValue}
              </span>
              <span className="max-w-[140px] text-caption font-semibold uppercase leading-[1.35] tracking-[0.08em] text-[#0a0d12]/60">
                {proof.toolsLabel}
              </span>
            </span>
            <TileArrow />
          </Link>

          <ProviderTile name="Antigravity" />
          <ProviderTile name="Qwen Code" />
          <ProviderTile name="Kimi CLI" />
          <ProviderTile name="DeepSeek Harness" />

          <div
            className={cn(
              tileClassName,
              "col-span-2 flex flex-col justify-center gap-2 px-5 py-4 sm:col-span-6 lg:col-span-4",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 whitespace-nowrap text-label font-semibold text-[#0a0d12]">
                <span className="grid size-6 place-items-center rounded-full bg-[#e8eefc] text-[#2a5bd7]">
                  <Bot className="size-3.5" aria-hidden />
                </span>
                Claude
                <span className="font-normal text-[#0a0d12]/48">MUL-18</span>
              </span>
              <span className="shrink-0 whitespace-nowrap rounded-full bg-[#eaf6d3] px-2 py-0.5 text-caption font-semibold text-[#3f6212]">
                {proof.activityLabel}
              </span>
            </div>
            <p className="text-body leading-[1.55] text-[#0a0d12]/72">
              {proof.activityBody}
            </p>
          </div>

          {selfHost ? (
            <div
              className={cn(
                tileClassName,
                "col-span-2 flex flex-col justify-center gap-1.5 px-5 py-4 sm:col-span-6 lg:col-span-4",
              )}
            >
              <p className="text-body-lg font-semibold text-[#0a0d12]">
                {selfHost.title}
              </p>
              <p className="text-body leading-[1.55] text-[#0a0d12]/64">
                {selfHost.description}
              </p>
            </div>
          ) : null}

          <ProviderTile name="OpenCode" />
        </div>
      </div>
    </section>
  );
}

const tileClassName =
  "rounded-[20px] bg-white shadow-[0_1px_2px_rgba(10,13,18,0.04)] transition-shadow";

function ProviderTile({
  name,
  large,
  className,
}: {
  name: string;
  large?: boolean;
  className?: string;
}) {
  const provider = HERO_PROVIDERS.find((p) => p.name === name);
  if (!provider) return null;
  return (
    <div
      className={cn(
        tileClassName,
        "flex items-center justify-center gap-2.5 px-4 text-[#0a0d12]/82 sm:col-span-2 lg:col-span-2",
        className,
      )}
    >
      <ProviderMark provider={provider} large={large} />
      <span
        className={cn(
          "text-center font-semibold leading-tight tracking-[-0.01em] text-balance",
          large ? "text-title-lg" : "text-body-lg",
        )}
      >
        {name}
      </span>
    </div>
  );
}

function ProviderMark({
  provider,
  large,
}: {
  provider: HeroProvider;
  large?: boolean;
}) {
  const { Mark } = provider;
  return <Mark className={cn("shrink-0", large ? "size-7" : "size-5")} />;
}

function TileArrow() {
  return (
    <ArrowUpRight
      className="size-4 shrink-0 text-[#0a0d12]/40 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#0a0d12]"
      aria-hidden
    />
  );
}

/** Renders `**phrase**` segments of a dictionary string in ink. */
function Emphasis({ text }: { text: string }) {
  return (
    <>
      {text.split("**").map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-[#0a0d12]">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
