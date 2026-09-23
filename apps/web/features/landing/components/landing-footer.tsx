"use client";

import Image from "next/image";
import Link from "next/link";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import { cn } from "@multica/ui/lib/utils";
import { useAuthStore } from "@multica/core/auth";
import {
  XMark,
  GitHubMark,
  DiscordMark,
  githubUrl,
  twitterUrl,
  discordUrl,
} from "./shared";
import { useLocale, locales, localeLabels } from "../i18n";
import { useDashboardCtaHref } from "../utils/use-dashboard-cta";

export function LandingFooter() {
  const { t, locale, setLocale } = useLocale();
  const user = useAuthStore((s) => s.user);
  const ctaHref = useDashboardCtaHref();
  const groups = Object.values(t.footer.groups);

  return (
    <footer className="relative isolate overflow-hidden bg-white text-[#0a0d12]">
      {/* The trail from the hero artwork, fading up out of the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,transparent,black_32%)]"
      >
        <Image
          src="/images/landing-bg.webp"
          alt=""
          fill
          className="object-cover object-[30%_90%]"
          sizes="100vw"
          quality={75}
        />
      </div>

      <div className="px-3 pt-48 sm:px-6 sm:pt-64 lg:px-10">
        <div className="mx-auto max-w-[1280px] rounded-t-[32px] bg-[#f4f2ee] px-6 pb-8 pt-12 sm:rounded-t-[40px] sm:px-10 lg:px-14 lg:pt-16">
          <div className="flex flex-col gap-12 lg:flex-row lg:gap-20">
            <div className="lg:w-[340px] lg:shrink-0">
              <p className="max-w-[320px] text-body-lg leading-[1.65] text-[#0a0d12]/64">
                {t.footer.tagline}
              </p>
              <div className="mt-5 flex items-center gap-2">
                {[
                  { href: twitterUrl, label: "X", Mark: XMark },
                  { href: githubUrl, label: "GitHub", Mark: GitHubMark },
                  { href: discordUrl, label: "Discord", Mark: DiscordMark },
                ].map(({ href, label, Mark }) => (
                  <Link
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={label}
                    className="grid size-10 place-items-center rounded-[12px] bg-[#0a0d12]/[0.07] text-[#0a0d12]/64 transition-colors hover:bg-[#0a0d12]/12 hover:text-[#0a0d12]"
                  >
                    <Mark className="size-4" />
                  </Link>
                ))}
              </div>
              <Link
                href={ctaHref}
                className="mt-6 inline-flex h-11 items-center justify-center rounded-[12px] bg-[#0a0d12] px-5 text-label font-semibold text-white transition-colors hover:bg-[#0a0d12]/85"
              >
                {user ? t.header.dashboard : t.footer.cta}
              </Link>
            </div>

            <div className="grid flex-1 grid-cols-2 gap-8 sm:grid-cols-3">
              {groups.map((group) => (
                <div key={group.label}>
                  <h4 className="text-caption font-semibold uppercase tracking-[0.14em] text-[#0a0d12]">
                    {group.label}
                  </h4>
                  <ul className="mt-5 flex flex-col gap-3">
                    {group.links.map((link) => (
                      <li key={link.label}>
                        <Link
                          href={link.href}
                          {...(link.href.startsWith("http")
                            ? { target: "_blank", rel: "noreferrer" }
                            : {})}
                          className="text-body-lg text-[#0a0d12]/64 transition-colors hover:text-[#0a0d12]"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-16 flex flex-col gap-6 border-t border-[#0a0d12]/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/" className="flex items-center gap-2.5">
              <MulticaIcon className="size-6 text-[#0a0d12]" noSpin />
              <span className="text-display-sm font-semibold tracking-[-0.01em] lowercase">
                multica
              </span>
            </Link>
            <p className="text-label text-[#0a0d12]/56">
              {t.footer.copyright.replace(
                "{year}",
                String(new Date().getFullYear()),
              )}
            </p>
            <div className="flex items-center">
              {locales.map((l, i) => (
                <button
                  type="button"
                  key={l}
                  onClick={() => setLocale(l)}
                  className={cn(
                    "px-2 py-1 text-caption font-medium transition-colors",
                    l === locale
                      ? "text-[#0a0d12]"
                      : "text-[#0a0d12]/40 hover:text-[#0a0d12]/64",
                    i > 0 && "border-l border-[#0a0d12]/12",
                  )}
                >
                  {localeLabels[l]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
