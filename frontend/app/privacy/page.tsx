import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — HouseScout",
  description: "How HouseScout handles your data.",
};

const UPDATED = "22 June 2026";

export default function PrivacyPage() {
  return (
    <article className="prose-legal mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Privacy Policy</h1>
        <p className="text-sm text-slate-500">Last updated: {UPDATED}</p>
      </header>

      <Section title="1. Overview">
        <p>
          HouseScout (“we”, “our”, “the app”) is a personal-use property research tool for
          Christchurch, New Zealand. It is published as a static website on GitHub Pages and runs
          entirely in your browser. We have deliberately designed it to collect as little personal
          information as possible. This policy explains what is and isn’t collected.
        </p>
      </Section>

      <Section title="2. Information we do NOT collect">
        <ul>
          <li>We do not require an account, login, name, email address or phone number.</li>
          <li>We do not operate an application server or database that stores your activity.</li>
          <li>We do not sell, rent or share personal information with advertisers.</li>
          <li>We do not run third-party advertising or behavioural-tracking networks.</li>
        </ul>
      </Section>

      <Section title="3. Information processed in your browser">
        <p>
          Some preferences are stored locally on your own device using your browser’s
          <code> localStorage</code>. This data never leaves your device and is not transmitted to us:
        </p>
        <ul>
          <li>Your optional local AI endpoint URL and model name (Settings page).</li>
          <li>Your acknowledgement of the cookie/consent notice.</li>
          <li>Cached AI analysis text to avoid recomputation.</li>
        </ul>
        <p>You can clear this at any time by clearing your browser’s site data for HouseScout.</p>
      </Section>

      <Section title="4. Hosting logs (GitHub Pages)">
        <p>
          The site is hosted on GitHub Pages, operated by GitHub, Inc. When you load any website,
          the host’s servers automatically receive standard technical information such as your IP
          address, browser type and the pages requested, and may log it for security and operational
          purposes. This is outside our control and is governed by{" "}
          <a href="https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement" target="_blank" rel="noreferrer">
            GitHub’s Privacy Statement
          </a>.
        </p>
      </Section>

      <Section title="5. Optional local AI model">
        <p>
          If you choose to connect a local AI model (e.g. LM Studio) via the Settings page, the
          questions and listing data you submit are sent directly from your browser to the endpoint
          URL you configure (typically <code>http://localhost</code> on your own machine). HouseScout
          does not intercept, store or relay that traffic. If you point the endpoint at a third-party
          service, their privacy terms apply.
        </p>
      </Section>

      <Section title="6. Property listing data">
        <p>
          Listing information displayed in the app is aggregated from publicly available real-estate
          sources for personal, non-commercial research. It may be incomplete, out of date or
          inaccurate. It is not personal information about you. Property images are reproduced from
          their source listings; rights remain with their respective owners.
        </p>
      </Section>

      <Section title="7. Your rights (NZ Privacy Act 2020)">
        <p>
          Because we do not collect or hold personal information about you on our servers, there is
          generally no personal data for us to access, correct or delete. For data held in your own
          browser, you control it directly. For host-level logs, contact GitHub. You may complain to
          the{" "}
          <a href="https://www.privacy.org.nz/" target="_blank" rel="noreferrer">Office of the Privacy Commissioner</a>{" "}
          if you believe your privacy rights have been breached.
        </p>
      </Section>

      <Section title="8. Children">
        <p>HouseScout is intended for adults researching property purchases and is not directed at children.</p>
      </Section>

      <Section title="9. Changes to this policy">
        <p>
          We may update this policy as the app evolves. The “Last updated” date above reflects the
          current version. Material changes will be reflected on this page.
        </p>
      </Section>

      <Section title="10. Contact">
        <p>
          This is a personal-use project. Privacy questions can be raised via the project’s GitHub
          repository issues page.
        </p>
      </Section>

      <p className="text-xs text-slate-400">
        This policy is provided for transparency and general information only and is not legal advice.
      </p>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}
