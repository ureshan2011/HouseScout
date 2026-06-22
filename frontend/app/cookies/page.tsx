import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookie Policy — HouseScout",
  description: "How HouseScout uses cookies and local storage.",
};

const UPDATED = "22 June 2026";

export default function CookiesPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Cookie &amp; Local Storage Policy</h1>
        <p className="text-sm text-slate-500">Last updated: {UPDATED}</p>
      </header>

      <Section title="1. Summary">
        <p>
          HouseScout does <strong>not</strong> use tracking cookies, advertising cookies, or
          third-party analytics cookies. The app is a static site that runs in your browser. The only
          client-side storage it uses is your browser’s <code>localStorage</code>, strictly to remember
          your own settings on your own device.
        </p>
      </Section>

      <Section title="2. What we store on your device">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-2">Key</th>
                <th>Type</th>
                <th>Purpose</th>
                <th>Retention</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              <Row k="housescout.lmBaseUrl" type="localStorage" purpose="Remembers your optional local AI endpoint URL." retention="Until you clear it" />
              <Row k="housescout.lmChatModel" type="localStorage" purpose="Remembers your chosen local AI model name." retention="Until you clear it" />
              <Row k="housescout.cookieConsent" type="localStorage" purpose="Remembers that you dismissed the consent notice, so it isn’t shown again." retention="Until you clear it" />
            </tbody>
          </table>
        </div>
        <p>
          None of these are transmitted to us or to any third party. They are purely functional and
          necessary for the features you choose to use.
        </p>
      </Section>

      <Section title="3. Cookies we do not set">
        <ul>
          <li>No advertising or retargeting cookies.</li>
          <li>No social-media tracking pixels.</li>
          <li>No cross-site or third-party analytics cookies.</li>
        </ul>
      </Section>

      <Section title="4. Third-party hosting">
        <p>
          The site is served by GitHub Pages. GitHub may process standard server logs (such as IP
          addresses) for security and operations as described in our{" "}
          <a href="/privacy">Privacy Policy</a>. Map tiles and any externally hosted images are
          requested from their providers when you view a page that uses them; those providers may
          receive your IP address as part of serving the request.
        </p>
      </Section>

      <Section title="5. Managing your data">
        <p>
          You can delete everything HouseScout stores at any time by clearing site data / local
          storage for this site in your browser settings. Doing so simply resets your preferences —
          the app will continue to work.
        </p>
      </Section>

      <Section title="6. Consent">
        <p>
          Because we only use strictly-necessary functional storage and no tracking, a banner is shown
          for transparency rather than to obtain consent for tracking. Dismissing it records a single
          functional flag (see the table above) so we don’t show it again.
        </p>
      </Section>

      <p className="text-xs text-slate-400">
        This policy is provided for transparency and general information only and is not legal advice.
      </p>
    </article>
  );
}

function Row({ k, type, purpose, retention }: { k: string; type: string; purpose: string; retention: string }) {
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="py-2 font-mono text-xs">{k}</td>
      <td className="text-xs">{type}</td>
      <td className="text-xs">{purpose}</td>
      <td className="text-xs">{retention}</td>
    </tr>
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
