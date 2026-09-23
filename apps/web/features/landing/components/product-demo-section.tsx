"use client";

import Image from "next/image";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@multica/ui/components/ui/tabs";
import { useLocale } from "../i18n";
import type { LandingDict } from "../i18n";
import {
  AutonomousVisual,
  RuntimesVisual,
  SkillsVisual,
  TeammatesVisual,
} from "./features-section";
import { GuideRails } from "./shared";

type DemoTab = keyof LandingDict["home"]["demo"]["tabs"];

const DEMO_TABS: { value: DemoTab; Visual: () => React.ReactElement }[] = [
  { value: "board", Visual: BoardVisual },
  { value: "assign", Visual: TeammatesVisual },
  { value: "execute", Visual: AutonomousVisual },
  { value: "skills", Visual: SkillsVisual },
  { value: "runtimes", Visual: RuntimesVisual },
];

export function ProductDemoSection() {
  const { t } = useLocale();
  const demo = t.home.demo;

  return (
    <section id="product" className="relative bg-white text-[#0a0d12]">
      <GuideRails />

      <div className="relative mx-auto max-w-[1184px] px-5 pt-28 text-center sm:px-8 sm:pt-36">
        <h2 className="landing-display text-[2.75rem] font-semibold leading-[1] tracking-[-0.045em] sm:text-[4rem] lg:text-[4.75rem]">
          {demo.headlineLine1}
          <br />
          {demo.headlineLine2}
        </h2>
        <p className="mx-auto mt-6 max-w-[560px] text-title-sm text-[#0a0d12]/64 sm:text-title-lg sm:leading-[1.5]">
          {demo.subheading}
        </p>
      </div>

      <Tabs defaultValue="board" className="relative mt-10 gap-0">
        <div className="overflow-x-auto px-5 [scrollbar-width:none] sm:px-8">
          <TabsList className="mx-auto flex h-auto w-max gap-2 rounded-none bg-transparent p-0 group-data-horizontal/tabs:h-auto">
            {DEMO_TABS.map(({ value }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="h-11 flex-none rounded-[12px] bg-[#f4f2ee] px-4 text-body-lg font-medium text-[#0a0d12]/62 hover:text-[#0a0d12] data-active:bg-[#0a0d12] data-active:text-white data-active:shadow-none"
              >
                {demo.tabs[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="mt-8 px-3 sm:px-6 lg:px-10">
          <div className="relative mx-auto max-w-[1280px] overflow-hidden rounded-[32px] bg-[linear-gradient(to_bottom,#bccdfb,#e4ebfd_70%,#eef2fd)] sm:rounded-[40px]">
            <div className="relative px-3 py-6 sm:px-10 sm:py-14 lg:px-20 lg:py-20">
              {DEMO_TABS.map(({ value, Visual }) => (
                <TabsContent
                  key={value}
                  value={value}
                  className="mx-auto max-w-[1040px]"
                >
                  <Visual />
                </TabsContent>
              ))}
            </div>
          </div>
        </div>
      </Tabs>
    </section>
  );
}

/** The real board screenshot, letterboxed into the 16:9 frame the mocks share. */
function BoardVisual() {
  const { t } = useLocale();
  return (
    <div className="relative aspect-video">
      <Image
        src="/images/landing-hero.webp"
        alt={t.hero.imageAlt}
        fill
        className="object-contain drop-shadow-[0_24px_48px_rgba(0,0,0,0.28)]"
        sizes="(max-width: 1040px) 100vw, 1040px"
        quality={85}
      />
    </div>
  );
}
