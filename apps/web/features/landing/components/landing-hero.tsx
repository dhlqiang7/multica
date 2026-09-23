"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";
import { useAuthStore } from "@multica/core/auth";
import { docsHrefForLocale, useLocale } from "../i18n";
import { useDashboardCtaHref } from "../utils/use-dashboard-cta";
import { HERO_PROVIDERS } from "./provider-marks";

export function LandingHero() {
  const { t, locale } = useLocale();
  const user = useAuthStore((s) => s.user);
  const ctaHref = useDashboardCtaHref();

  return (
    <section className="relative isolate overflow-hidden bg-[#143b8f] text-white">
      <LandingBackdrop />

      <div className="relative mx-auto flex min-h-[760px] max-w-[1280px] flex-col justify-end px-5 pb-40 pt-44 sm:px-8 lg:min-h-[900px] lg:px-12 lg:pb-48">
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:items-end xl:gap-16">
          <h1 className="landing-display text-[2.625rem] font-semibold leading-[0.98] tracking-[-0.045em] drop-shadow-[0_8px_30px_rgba(8,20,60,0.35)] sm:text-[4.5rem] lg:text-[5.25rem]">
            {t.hero.headlineLine1}
            <br />
            {t.hero.headlineLine2}
          </h1>

          <div className="xl:pb-2">
            <p className="max-w-[460px] text-title-sm text-white/88 sm:text-title-lg sm:leading-[1.5]">
              {t.hero.subheading}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href={ctaHref}
                className="group inline-flex h-12 items-center gap-2 rounded-[14px] bg-white px-5 text-body-lg font-semibold text-[#0a0d12] transition-colors hover:bg-white/90"
              >
                {user ? t.header.dashboard : t.hero.cta}
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
              <Link
                href="/download"
                className="inline-flex h-12 items-center gap-2 rounded-[14px] bg-[#d7f36b] px-5 text-body-lg font-semibold text-[#10142a] transition-colors hover:bg-[#cdea5c]"
              >
                <Download className="size-4" aria-hidden />
                {t.hero.downloadDesktop}
              </Link>
            </div>

            <WorksWithRow
              label={t.hero.worksWith}
              href={`${docsHrefForLocale(locale)}/providers`}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The runtime catalog is far longer than this row (see `/docs/providers`), so
 * the marks are a sample and the label carries the full claim — that split is
 * what keeps the row honest without growing it every time a runtime lands.
 */
function WorksWithRow({ label, href }: { label: string; href: string }) {
  return (
    <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3">
      <Link
        href={href}
        className="group inline-flex items-center gap-1.5 text-body-lg text-white/72 transition-colors hover:text-white"
      >
        {label}
        <ArrowRight
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
      <ul className="flex items-center gap-1.5">
        {HERO_PROVIDERS.slice(0, 5).map(({ name, Mark }) => (
          <li
            key={name}
            title={name}
            className="grid size-8 place-items-center rounded-full bg-white/14 text-white ring-1 ring-white/18 backdrop-blur-sm"
          >
            <Mark className="size-4" />
            <span className="sr-only">{name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LandingBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10">
      {/* This artwork is above the fold, so preload it. */}
      <Image
        src="/images/landing-bg.webp"
        alt=""
        fill
        preload
        className="object-cover object-[center_35%]"
        sizes="100vw"
      />
      {/* Deepen the lower half so the headline and CTAs read on any crop. */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(20,59,143,0)_35%,rgba(20,59,143,0.55)_70%,#143b8f_100%)]" />
    </div>
  );
}
