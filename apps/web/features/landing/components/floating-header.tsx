"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import { useAuthStore } from "@multica/core/auth";
import { docsHrefForLocale, useLocale } from "../i18n";
import { useDashboardCtaHref } from "../utils/use-dashboard-cta";
import { formatStarCount, useGithubStars } from "../utils/use-github-stars";
import {
  GitHubStarsBadge,
  mobileNavLinkClassName,
  navLinkClassName,
} from "./landing-header";
import { GitHubMark, githubUrl } from "./shared";

/**
 * Home page header: an inset white card pinned to the top of the landing
 * scroller, with the latest release announced above the nav. It sits in a
 * zero-height sticky wrapper so the hero artwork runs underneath it instead of
 * starting below it.
 */
export function FloatingHeader() {
  const { t, locale } = useLocale();
  const user = useAuthStore((s) => s.user);
  const stars = useGithubStars();
  const starsLabel = stars != null ? formatStarCount(stars) : null;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const docsHref = docsHrefForLocale(locale);
  const navLinks = [
    { href: "/usecases", label: t.header.useCases },
    { href: docsHref, label: t.header.docs },
    { href: "/changelog", label: t.header.changelog },
  ];
  const ctaHref = useDashboardCtaHref();

  return (
    <header className="sticky top-0 z-40 h-0 px-3 sm:px-6 lg:px-9">
      <div className="relative mx-auto max-w-[1368px]">
        <div className="overflow-hidden rounded-b-[20px] bg-white shadow-[0_1px_0_rgba(10,13,18,0.06),0_18px_40px_-28px_rgba(10,13,18,0.45)]">
          <AnnouncementBar />

          <div className="flex h-[60px] items-center justify-between gap-4 pl-5 pr-2.5 sm:pl-6">
            <div className="flex min-w-0 items-center gap-6 lg:gap-8">
              <Link href="/" className="flex shrink-0 items-center gap-2.5">
                <MulticaIcon className="size-5 text-[#0a0d12]" noSpin />
                <span className="text-title-lg font-semibold tracking-[0.02em] text-[#0a0d12] lowercase">
                  multica
                </span>
              </Link>

              <nav
                aria-label={t.header.navigation}
                className="hidden items-center gap-0.5 md:flex"
              >
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={navLinkClassName("light")}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Link
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                className="hidden h-10 items-center gap-2 rounded-[12px] px-3 text-label font-medium text-[#0a0d12]/72 transition-colors hover:bg-[#0a0d12]/5 hover:text-[#0a0d12] lg:inline-flex"
              >
                <GitHubMark className="size-3.5" />
                {t.header.github}
                {starsLabel ? <GitHubStarsBadge label={starsLabel} /> : null}
              </Link>
              <Link
                href="/contact-sales"
                className="hidden h-10 items-center rounded-[12px] bg-[#f1efea] px-4 text-label font-medium text-[#0a0d12] transition-colors hover:bg-[#e8e5de] sm:inline-flex"
              >
                {t.hero.talkToSales}
              </Link>
              <Link
                href={ctaHref}
                className="inline-flex h-10 items-center rounded-[12px] bg-[#0a0d12] px-4 text-label font-medium text-white transition-colors hover:bg-[#0a0d12]/85"
              >
                {user ? t.header.dashboard : t.header.cta}
              </Link>
              <button
                type="button"
                aria-label={isMenuOpen ? t.header.closeMenu : t.header.openMenu}
                aria-expanded={isMenuOpen}
                onClick={() => setIsMenuOpen((open) => !open)}
                className="inline-flex size-10 items-center justify-center rounded-[12px] text-[#0a0d12] transition-colors hover:bg-[#0a0d12]/5 md:hidden"
              >
                {isMenuOpen ? (
                  <X className="size-4" aria-hidden />
                ) : (
                  <Menu className="size-4" aria-hidden />
                )}
              </button>
            </div>
          </div>
        </div>

        {isMenuOpen ? (
          <div className="absolute inset-x-0 top-[calc(100%+8px)] rounded-[20px] bg-white p-2 text-[#0a0d12] shadow-[0_18px_60px_rgba(0,0,0,0.18)] ring-1 ring-[#0a0d12]/8 md:hidden">
            <nav aria-label={t.header.navigation} className="flex flex-col">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMenuOpen(false)}
                  className={mobileNavLinkClassName("light")}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/contact-sales"
                onClick={() => setIsMenuOpen(false)}
                className={mobileNavLinkClassName("light")}
              >
                {t.hero.talkToSales}
              </Link>
            </nav>
            <div className="mt-2 border-t border-[#0a0d12]/8 pt-2">
              <Link
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => setIsMenuOpen(false)}
                className={mobileNavLinkClassName("light")}
              >
                <GitHubMark className="size-3.5" />
                {t.header.github}
                {starsLabel ? <GitHubStarsBadge label={starsLabel} /> : null}
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** Latest release, read from the same dictionary the changelog page renders. */
function AnnouncementBar() {
  const { t } = useLocale();
  const latest = t.changelog.entries[0];
  if (!latest) return null;

  return (
    <Link
      href="/changelog"
      className="group flex h-10 items-center justify-between gap-4 bg-[#10142a] px-5 text-label text-white sm:px-6"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 rounded-full bg-[#d7f36b] px-2 py-0.5 text-caption font-semibold tabular-nums text-[#10142a]">
          v{latest.version}
        </span>
        <span className="truncate text-white/82 transition-colors group-hover:text-white">
          {latest.title}
        </span>
      </span>
      <span className="hidden shrink-0 items-center gap-1.5 text-caption font-semibold uppercase tracking-[0.12em] text-[#d7f36b] sm:inline-flex">
        {t.header.announcementCta}
        <ArrowRight
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </Link>
  );
}
