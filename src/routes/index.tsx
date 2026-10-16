import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Plutus — منصة تداول للموبايل" },
      {
        name: "description",
        content: "منصة Plutus للتداول بأسعار حية ورسوم شموع وصفقات بتصميم MT5 للموبايل.",
      },
      { property: "og:title", content: "Plutus — منصة تداول" },
      { property: "og:description", content: "أسعار حية ورسوم بيانية وإدارة صفقات بتصميم MT5." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: App,
});

function App() {
  return (
    <iframe
      src="/plotos/index.html"
      title="Plutus"
      className="fixed inset-0 h-[100dvh] w-full border-0 bg-background"
      allow="clipboard-write; fullscreen"
    />
  );
}
