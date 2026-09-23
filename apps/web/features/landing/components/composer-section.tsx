"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useLocale } from "../i18n";
import { useDashboardCtaHref } from "../utils/use-dashboard-cta";
import { GuideRails } from "./shared";

/**
 * "What should your agents work on?" — an issue composer as the call to
 * action. Submitting continues to the same destination as the hero CTA; the
 * suggestions only prefill the field.
 */
export function ComposerSection() {
  const { t } = useLocale();
  const router = useRouter();
  const ctaHref = useDashboardCtaHref();
  const composer = t.home.composer;
  const inputId = useId();
  const [draft, setDraft] = useState("");

  return (
    <section className="relative bg-white text-[#0a0d12]">
      <GuideRails />

      <div className="relative mx-auto max-w-[760px] px-5 py-28 text-center sm:px-8 sm:py-36">
        <h2 className="landing-display text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[3.5rem]">
          {composer.headline}
        </h2>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            router.push(ctaHref);
          }}
          className="mt-10 rounded-[28px] bg-[#f4f2ee] p-1.5 text-left"
        >
          <label htmlFor={inputId} className="sr-only">
            {composer.inputLabel}
          </label>
          <textarea
            id={inputId}
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={composer.placeholder}
            className="block w-full resize-none rounded-[22px] bg-white px-5 py-4 text-title-sm text-[#0a0d12] shadow-[0_1px_2px_rgba(10,13,18,0.06)] ring-1 ring-[#0a0d12]/8 outline-none transition-shadow placeholder:text-[#0a0d12]/40 focus-visible:ring-2 focus-visible:ring-[#0a0d12]/24"
          />
          <div className="flex items-end gap-3 px-2 pb-1.5 pt-3 sm:items-center">
            <div className="flex flex-1 flex-wrap gap-2">
              {composer.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setDraft(suggestion)}
                  className="h-9 rounded-[10px] bg-white px-3 text-label font-medium text-[#0a0d12]/64 shadow-[0_1px_2px_rgba(10,13,18,0.05)] transition-colors hover:text-[#0a0d12]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <button
              type="submit"
              aria-label={composer.submit}
              title={composer.submit}
              className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-[#0a0d12] text-white transition-colors hover:bg-[#0a0d12]/85"
            >
              <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
