import type { Metadata } from 'next';
import { LegalPage, Section } from '../../../components/legal';

/**
 * Privacy policy.
 *
 * ⚠️ TWO THINGS NEED A HUMAN BEFORE THIS IS PUBLISHED:
 *   1. A lawyer's eye. I am not one. The content is factually accurate about
 *      what the system does — every claim below is checkable against the schema
 *      and the code — but factual accuracy is not the same as legal sufficiency
 *      for whichever jurisdiction applies.
 *   2. The contact route and the controller's jurisdiction (decision D23).
 *
 * The rule this file must keep: it describes what the code ACTUALLY does. If a
 * feature changes what is collected, this page changes in the same PR. A policy
 * that drifts from the system is worse than none, because people relied on it.
 */

export const metadata: Metadata = {
  title: "Privacy Policy — Grim's Squad Hub",
  description:
    'What Grim’s Squad Hub collects, why, how long it is kept, and how to have it deleted.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      version="1.0"
      updated="26 July 2026"
      summary="We sign you in with Discord and read your roles in our server. We do not ask for your
      email address, we cannot read your messages, and we cannot see what other servers you are in.
      Everything about your in-game activity is off by default and stays off until you turn it on.
      Ask us to delete your account and we delete it."
    >
      <Section id="who" heading="Who we are">
        <p>
          Grim&rsquo;s Squad Hub is the private members&rsquo; platform for Grim&rsquo;s Squad, a
          player squadron in <em>Elite Dangerous</em>. It is run by the squadron&rsquo;s leadership
          for its own members. It is not a commercial service, it is not open to the public, and it
          sells nothing.
        </p>
      </Section>

      <Section id="collect" heading="What we collect">
        <p>When you sign in with Discord, we receive and store:</p>
        <ul>
          <li>
            <strong>Your Discord account ID</strong> &mdash; the permanent numeric identifier. This
            is how we recognise you on your next visit.
          </li>
          <li>
            <strong>Your Discord username, display name and avatar</strong> &mdash; so the site can
            show who you are rather than a number.
          </li>
          <li>
            <strong>Your roles in the Grim&rsquo;s Squad Discord server</strong> &mdash; this is how
            the site knows whether you are a member, an officer, or an applicant, and therefore what
            you are allowed to see.
          </li>
          <li>
            <strong>The date you joined the server</strong> &mdash; used to calculate your tenure
            rank. It is calculated fresh each time rather than stored as a rank, so it cannot drift
            from the truth.
          </li>
          <li>
            <strong>Access and refresh tokens from Discord</strong> &mdash; encrypted before they
            are written to the database (see <a href="#security">Security</a>).
          </li>
        </ul>
        <p>
          As you use the site we also store what you create: forum posts, ship loadouts, event
          sign-ups, and similar. That is ordinary content you chose to write.
        </p>
      </Section>

      <Section id="not-collect" heading="What we deliberately do not collect">
        <ul>
          <li>
            <strong>Your email address.</strong> We do not request the <code>email</code> permission
            from Discord at all. There is no email anywhere in this platform &mdash; no newsletters,
            no password resets, no notifications &mdash; so an address could never be used for
            anything. Storing personal data with no purpose only creates something to lose.
          </li>
          <li>
            <strong>Your messages.</strong> The bot does not have the Message Content permission. It
            cannot read what you write in Discord, in any channel, ever.
          </li>
          <li>
            <strong>Other servers you are in.</strong> We request access to your membership of{' '}
            <em>our</em> server specifically, not the list of servers you belong to.
          </li>
          <li>
            <strong>Payment details.</strong> We take no payments.
          </li>
          <li>
            <strong>Third-party analytics and advertising.</strong> There are no trackers, no
            advertising pixels and no analytics products on this site. Web fonts are served from our
            own server rather than Google&rsquo;s, so loading a page does not tell anyone else that
            you visited.
          </li>
        </ul>
      </Section>

      <Section id="game-data" heading="Game data, and what you can turn off">
        <p>
          The platform shows squadron activity &mdash; where members are, what they fly, what they
          have hauled. Most of that is <strong>visible to other members by default</strong>, because
          a squadron roster where everybody is hidden is a roster nobody can use. Each one is a
          switch you can turn off at any time:
        </p>
        <ul>
          <li>Your location</li>
          <li>Your fleet</li>
          <li>Your recent activity</li>
          <li>Whether you appear on the squadron roster, which signed-in members can see</li>
          <li>Whether you appear on leaderboards</li>
        </ul>
        <p>
          {/*
            The one exception, stated as prominently as the rule. A default that goes the other way
            is exactly the kind of thing a policy must name rather than leave somebody to discover.
          */}
          <strong>Your credit balance is the exception.</strong> It starts switched{' '}
          <strong>off</strong> and stays off until you deliberately turn it on. Nobody sees what you
          are worth unless you decide they should.
        </p>
        <p>
          Turning any of these off is enforced by the server, not by the page you are looking at:
          the information is <strong>absent</strong> from what other members and the public receive,
          not merely hidden by the interface. That holds regardless of what a browser is asked to do.
        </p>
        <p>
          Connecting your Frontier account, or uploading flight telemetry, are separate choices you
          make explicitly. Neither is required to use the site, and you can withdraw either at any
          time &mdash; see <a href="#control">what you can ask us to do</a>.
        </p>
      </Section>

      <Section id="why" heading="Why we hold it">
        <p>
          To operate a members&rsquo; site: to know who you are, to work out what you are allowed to
          see, to attribute the things you post to you, and to keep a record of administrative
          actions such as rank changes and moderation so they can be reviewed.
        </p>
        <p>
          We do not sell it, rent it, trade it, or hand it to advertisers. There is nobody to sell it
          to and no reason to.
        </p>
      </Section>

      <Section id="sharing" heading="Who else sees it">
        <ul>
          <li>
            <strong>Discord</strong> &mdash; the source of your identity. Their handling of your
            data is governed by their own privacy policy.
          </li>
          <li>
            <strong>Our hosting provider</strong> &mdash; the servers the site runs on. They hold
            the data at rest on our behalf and do not use it.
          </li>
          <li>
            <strong>Squadron officers</strong> &mdash; can see membership information, applications
            and moderation records, because administering the squadron requires it. Privileged
            actions are written to an audit log.
          </li>
        </ul>
        <p>That is the complete list.</p>
      </Section>

      <Section id="security" heading="Security">
        <p>
          Your Discord tokens are encrypted with AES-256-GCM <em>before</em> they reach the
          database. Each one is cryptographically bound to your account, so a stolen database row
          cannot be replayed against a different account &mdash; the decryption simply fails.
        </p>
        <p>
          Tokens are never written to logs, never included in error messages, never returned by the
          API, and never shown in the interface. Logs are scrubbed of tokens, secrets and IP
          addresses automatically.
        </p>
        <p>
          No system is perfectly secure, and we will not pretend otherwise. If we ever discover a
          breach affecting your data, we will tell the affected members directly and promptly rather
          than quietly.
        </p>
      </Section>

      <Section id="retention" heading="How long we keep it">
        <p>
          For as long as you are a member, plus a short period afterwards so that an accidental
          removal from Discord can be undone without losing your history.
        </p>
        <p>
          Audit log entries about administrative actions are kept longer, because their purpose is
          to make it possible to review what officers did after the fact.
        </p>
      </Section>

      <Section id="rights" heading="Your control over it">
        <ul>
          <li>
            <strong>See it.</strong> Ask an officer and we will give you a copy of everything we hold
            about you.
          </li>
          <li>
            <strong>Correct it.</strong> Most of it comes from Discord, so changing it there changes
            it here on your next sign-in.
          </li>
          <li>
            <strong>Delete it.</strong> Ask, and your account and personal data are removed. Posts
            you made in shared discussions may remain with your name detached, because deleting them
            outright would gut conversations other people took part in. Tell us if you want those
            gone too and we will discuss it.
          </li>
          <li>
            <strong>Withdraw consent.</strong> Every optional switch can be turned back off at any
            time, and doing so stops that data being shown immediately.
          </li>
          <li>
            <strong>Leave.</strong> Removing the application in your Discord settings revokes our
            access. Leaving the Discord server ends your access to the site.
          </li>
        </ul>
      </Section>

      <Section id="minors" heading="Younger members">
        <p>
          Discord requires its users to be at least 13, and older in some countries. We rely on that:
          if you are able to hold a Discord account, you meet the minimum age for this site.
        </p>
        <p>
          Some of our members are under 18. The privacy defaults described above apply to everyone
          equally and are deliberately conservative &mdash; nothing about your location, activity or
          fleet is visible unless you choose to make it so. If you are a parent or guardian with a
          concern, contact the squadron leadership and we will deal with it directly.
        </p>
      </Section>

      <Section id="changes" heading="Changes to this policy">
        <p>
          If what we collect changes, this page changes with it in the same update, and the version
          number at the top goes up. Material changes will be announced in Discord rather than
          slipped in quietly.
        </p>
      </Section>

      <Section id="contact" heading="Contact">
        <p>
          Message the squadron leadership in the Grim&rsquo;s Squad Discord server. If you would
          rather not use Discord, an officer can give you an alternative route.
        </p>
      </Section>
    </LegalPage>
  );
}
