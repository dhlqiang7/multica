"use client";

import { useState } from "react";
import { cn } from "@multica/ui/lib/utils";
import { useLocale } from "../i18n";
import { GuideRails } from "./shared";

export function FAQSection() {
  const { t } = useLocale();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="relative bg-white text-[#0a0d12]">
      <GuideRails />
      <div className="relative mx-auto grid max-w-[1184px] gap-10 px-5 pb-24 sm:px-8 sm:pb-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16 lg:px-12">
        <div>
          <p className="text-caption font-semibold uppercase tracking-[0.2em] text-[#0a0d12]/48">
            {t.faq.label}
          </p>
          <h2 className="landing-display mt-4 text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[3.25rem]">
            {t.faq.headline}
          </h2>
        </div>

        <div className="flex flex-col gap-2">
          {t.faq.items.map((faq, i) => (
            <div key={i} className="rounded-[20px] bg-[#f4f2ee]">
              <button
                type="button"
                aria-expanded={openIndex === i}
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="flex w-full items-start justify-between gap-4 px-6 py-5 text-left"
              >
                <span className="text-title-sm font-semibold leading-snug text-[#0a0d12]">
                  {faq.question}
                </span>
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-[#0a0d12]/48 transition-transform",
                    openIndex === i && "rotate-45",
                  )}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <path d="M6 1v10M1 6h10" />
                  </svg>
                </span>
              </button>
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out",
                  openIndex === i ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                  <p className="px-6 pb-6 pr-16 text-body leading-[1.7] text-[#0a0d12]/64 sm:text-body-lg">
                    {faq.answer}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
