import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Github, Layers, Swords } from "lucide-react";
import { GITHUB_REPO_URL } from "@/lib/constants";
const GUIDE_SECTIONS = [
  {
    heading: msg`Play with friends`,
    icon: Swords,
    body: msg`Connect to a server from the Lobby, then join a room — or create your own — to battle other players in real time.`,
  },
  {
    heading: msg`Customize your deck`,
    icon: Layers,
    body: msg`Open the Deck Editor to build decks from scratch, import existing lists, and fine-tune every card before you sit down at the table.`,
  },
  {
    heading: msg`Host your own Manabrew rooms`,
    icon: Github,
    body: msg`Want to run a private server for your playgroup?`,
    link: {
      label: msg`Find out how on GitHub`,
      href: GITHUB_REPO_URL,
    },
  },
];
export function OnboardingGuide() {
  const { i18n } = useLingui();
  return (
    <div className="space-y-3">
      {GUIDE_SECTIONS.map((section) => (
        <section
          key={section.heading.id}
          className="flex items-start gap-3.5 rounded-lg border border-border/60 bg-card/50 px-4 py-3.5 backdrop-blur-sm"
        >
          <section.icon className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-foreground">{i18n._(section.heading)}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {i18n._(section.body)}
              {section.link ? (
                <>
                  {" "}
                  <a
                    href={section.link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {i18n._(section.link.label)}
                  </a>
                  .
                </>
              ) : null}
            </p>
          </div>
        </section>
      ))}
    </div>
  );
}
