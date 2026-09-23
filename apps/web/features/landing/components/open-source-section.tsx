"use client";

import Link from "next/link";
import { ArrowRight, Eye, GitFork, Server, Users } from "lucide-react";
import { useLocale } from "../i18n";
import { formatStarCount, useGithubStars } from "../utils/use-github-stars";
import { GitHubMark, githubUrl } from "./shared";

// One glyph per highlight, in dictionary order: self-host, no lock-in,
// transparency, community.
const HIGHLIGHT_ICONS = [Server, GitFork, Eye, Users];

export function OpenSourceSection() {
  const { t } = useLocale();
  const stars = useGithubStars();

  return (
    <section
      id="open-source"
      className="bg-white px-3 py-6 text-[#0a0d12] sm:px-6 lg:px-10"
    >
      <div className="mx-auto max-w-[1280px] rounded-[32px] bg-[#f4f2ee] p-6 sm:rounded-[40px] sm:p-10 lg:p-14">
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="text-caption font-semibold uppercase tracking-[0.2em] text-[#0f766e]">
              {t.openSource.label}
            </p>
            <h2 className="landing-display mt-4 text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-[3.25rem]">
              <span className="block">{t.openSource.headlineLine1}</span>
              <span className="block text-[#0f766e]">
                {t.openSource.headlineLine2}
              </span>
            </h2>
            <Link
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="group mt-6 inline-flex items-center gap-2 border-b border-[#0a0d12] pb-0.5 text-body-lg font-medium"
            >
              {t.openSource.cta}
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </div>

          <div className="lg:pt-10">
            <p className="text-title-sm text-[#0a0d12]/80 sm:text-title-lg sm:leading-[1.5]">
              {t.openSource.description}
            </p>
            {stars != null ? (
              <div className="mt-6 flex items-center gap-3 text-body text-[#0a0d12]/64">
                <span className="grid size-9 place-items-center rounded-[10px] bg-white shadow-[0_1px_2px_rgba(10,13,18,0.06)]">
                  <GitHubMark className="size-4 text-[#0a0d12]" />
                </span>
                <span>
                  <strong className="font-semibold tabular-nums text-[#0a0d12]">
                    {formatStarCount(stars)}
                  </strong>{" "}
                  {t.home.proof.starsLabel}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:mt-14 lg:grid-cols-4">
          {t.openSource.highlights.map((item, i) => {
            const Icon = HIGHLIGHT_ICONS[i] ?? Server;
            return (
              <div
                key={item.title}
                className="rounded-[24px] bg-white p-6 shadow-[0_1px_2px_rgba(10,13,18,0.04)]"
              >
                <span className="grid size-10 place-items-center rounded-[12px] bg-[#e3f2ef] text-[#0f766e]">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-5 text-title-sm font-semibold">{item.title}</h3>
                <p className="mt-2 text-body leading-[1.6] text-[#0a0d12]/62">
                  {item.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
