"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuthStore } from "@multica/core/auth";
import { useLocale } from "../i18n";
import { useDashboardCtaHref } from "../utils/use-dashboard-cta";

export function FinalCtaSection() {
  const { t } = useLocale();
  const user = useAuthStore((s) => s.user);
  const ctaHref = useDashboardCtaHref();
  const finalCta = t.home.finalCta;

  return (
    <section className="bg-white px-5 pt-12 text-center text-[#0a0d12] sm:px-8 sm:pt-16">
      <h2 className="landing-display mx-auto max-w-[900px] text-[2.75rem] font-semibold leading-[1] tracking-[-0.045em] sm:text-[4rem] lg:text-[4.75rem]">
        {finalCta.headlineLine1}
        <br />
        {finalCta.headlineLine2}
      </h2>
      <p className="mx-auto mt-6 max-w-[520px] text-title-sm text-[#0a0d12]/64 sm:text-title-lg sm:leading-[1.5]">
        {finalCta.subheading}
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href={ctaHref}
          className="group inline-flex h-12 items-center gap-2 rounded-[14px] bg-[#0a0d12] px-5 text-body-lg font-semibold text-white transition-colors hover:bg-[#0a0d12]/85"
        >
          {user ? t.header.dashboard : t.hero.cta}
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
        <Link
          href="/contact-sales"
          className="group inline-flex h-12 items-center gap-2 rounded-[14px] px-5 text-body-lg font-semibold ring-1 ring-[#0a0d12] ring-inset transition-colors hover:bg-[#0a0d12]/5"
        >
          {t.hero.talkToSales}
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      </div>
    </section>
  );
}
