import type { Metadata } from 'next';
import { LegalPage, Section } from '../../../components/legal';

/**
 * Terms of service.
 *
 * ⚠️ NEEDS A HUMAN BEFORE PUBLISHING — same caveat as the privacy policy, plus
 * one specific gap: the governing-law section is deliberately left general
 * because I do not know which jurisdiction the squadron operates from
 * (decision D23). That is a question only the human can answer, and inventing
 * an answer would be worse than leaving it open.
 */

export const metadata: Metadata = {
  title: "Terms of Service — Grim's Squad Hub",
  description: 'The rules for using Grim’s Squad Hub, the squadron members’ platform.',
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      version="1.0"
      updated="26 July 2026"
      summary="This is a private site for members of the Grim’s Squad Discord server. Be decent to
      each other, do not break Frontier’s or Discord’s rules, and understand that this is a hobby
      project run by volunteers — it can go down, lose data, or change without notice. If you are
      removed from the Discord server, your access here ends with it."
    >
      <Section id="what" heading="What this is">
        <p>
          Grim&rsquo;s Squad Hub is a private, non-commercial platform for members of the
          Grim&rsquo;s Squad squadron in <em>Elite Dangerous</em>. It is run by squadron members, in
          their own time, at their own expense. Nothing is sold here and nothing is charged for.
        </p>
      </Section>

      <Section id="access" heading="Who can use it">
        <p>
          Access requires membership of the Grim&rsquo;s Squad Discord server. Signing in is done
          through Discord; there is no separate account and no password.
        </p>
        <p>
          What you can see and do here follows your roles in that Discord server. If your roles
          change, your access changes with them. If you leave or are removed from the server, your
          access to this site ends at the same time.
        </p>
      </Section>

      <Section id="conduct" heading="How to behave">
        <p>Use of this site is conditional on all of the following:</p>
        <ul>
          <li>Treat other members with basic respect. Harassment of any kind is not tolerated.</li>
          <li>
            No content that is illegal, hateful, sexually explicit, or targets someone for who they
            are.
          </li>
          <li>
            Do not attempt to access information you have not been granted. That includes probing
            the site for ways around its permission checks.
          </li>
          <li>
            Do not scrape, automate against, or overload the site. If you want data for a legitimate
            purpose, ask &mdash; we will probably just give it to you.
          </li>
          <li>
            Do not upload anything that would breach Frontier Developments&rsquo; terms or
            Discord&rsquo;s terms. Your obligations to them remain yours.
          </li>
          <li>
            Do not post other people&rsquo;s personal information, whether or not they are squadron
            members.
          </li>
        </ul>
      </Section>

      <Section id="content" heading="What you post">
        <p>
          You keep ownership of what you write. By posting it here you allow us to store and display
          it within the site so it works as intended &mdash; nothing more. We will not republish it
          elsewhere or use it commercially.
        </p>
        <p>
          You are responsible for what you post, and you confirm you have the right to post it.
        </p>
      </Section>

      <Section id="moderation" heading="Moderation and removal">
        <p>
          Officers may edit, hide or remove content, and may suspend or remove access, where these
          terms have been broken or where it is necessary to keep the squadron functioning.
        </p>
        <p>
          Privileged actions are recorded in an audit log with who did what and when. If you think a
          decision was wrong, raise it with squadron leadership &mdash; there is a record to look at.
        </p>
      </Section>

      <Section id="availability" heading="Availability, and honest expectations">
        <p>
          This is a hobby project maintained by volunteers. It is provided as it is, with no
          guarantees. It may be unavailable, may lose data, may contain defects, and may change or
          shut down at any time.
        </p>
        <p>
          Game data shown here &mdash; market prices, system states, routes &mdash; comes from
          player-reported sources and can be out of date or wrong. Every price is shown with its age
          for exactly that reason. <strong>Check before you commit a long haul.</strong> Decisions
          you make based on this data are yours.
        </p>
        <p>
          To the fullest extent the law allows, the people running this site are not liable for any
          loss arising from its use. In-game losses are part of the game.
        </p>
      </Section>

      <Section id="frontier" heading="Elite Dangerous and Frontier Developments">
        <p>
          This site is created using assets and imagery from Elite: Dangerous, with the permission of
          Frontier Developments plc, for non-commercial purposes. It is not endorsed by Frontier
          Developments, and no Frontier Developments employee was involved in making it.
        </p>
        <p>
          <em>Elite Dangerous</em> and all related marks belong to Frontier Developments plc. This
          site is an unofficial fan project. Ship-fit mathematics is derived from Coriolis under the
          MIT licence, with attribution.
        </p>
      </Section>

      <Section id="changes" heading="Changes">
        <p>
          These terms may change as the site develops. The version number and date at the top will
          change with them, and material changes will be announced in Discord. Continuing to use the
          site after a change means you accept it.
        </p>
      </Section>

      <Section id="law" heading="Governing law">
        <p>
          These terms are governed by the law of the jurisdiction in which the squadron&rsquo;s
          leadership resides. Nothing here removes any statutory right you have that cannot be
          waived under the law that applies to you.
        </p>
      </Section>

      <Section id="contact" heading="Contact">
        <p>Message the squadron leadership in the Grim&rsquo;s Squad Discord server.</p>
      </Section>
    </LegalPage>
  );
}
