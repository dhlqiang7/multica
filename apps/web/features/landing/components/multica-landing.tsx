"use client";

import { FloatingHeader } from "./floating-header";
import { LandingHero } from "./landing-hero";
import { ProofSection } from "./proof-section";
import { ProductDemoSection } from "./product-demo-section";
import { ComposerSection } from "./composer-section";
import { FeaturesSection } from "./features-section";
import { OpenSourceSection } from "./open-source-section";
import { HowItWorksSection } from "./how-it-works-section";
import { FAQSection } from "./faq-section";
import { FinalCtaSection } from "./final-cta-section";
import { LandingFooter } from "./landing-footer";

export function MulticaLanding() {
  return (
    <div className="bg-white">
      <FloatingHeader />
      <LandingHero />
      <ProofSection />
      <ProductDemoSection />
      <ComposerSection />
      <FeaturesSection />
      <OpenSourceSection />
      <HowItWorksSection />
      <FAQSection />
      <FinalCtaSection />
      <LandingFooter />
    </div>
  );
}
