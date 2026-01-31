import RedirectClient from "./RedirectClient";

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function CompanyRedirectPage({ searchParams }: PageProps) {
  const rawTicker = searchParams?.ticker;
  const ticker = Array.isArray(rawTicker)
    ? rawTicker[0] ?? ""
    : rawTicker ?? "";

  return <RedirectClient ticker={ticker} />;
}
