import OnlineStatus from "@/app/components/OnlineStatus";

export default function SiteFooter() {
  return (
    <footer className="mt-6 px-6 pb-6 text-white/70">
      <div className="mx-auto max-w-6xl">
        <div className="flex justify-end pb-3">
          <OnlineStatus />
        </div>
        <div className="border-t border-white/40" />
        <div className="mt-4 grid gap-6 text-sm md:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">
              Company
            </p>
            <p className="mt-3 font-semibold text-white">Wizyrd Fantasy Markets</p>
            <p className="mt-1">1465 East Putnam Avenue</p>
            <p>Suite 633</p>
            <p>Greenwich, CT 06870</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">
              Contact
            </p>
            <p className="mt-3">Phone: (203) 496-7931</p>
            <p>Email: support@wizyrd.com</p>
            <p>Customer service: 24/7</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">
              Responsible Play
            </p>
            <p className="mt-3">Gambling hotline: 1-800-522-4700</p>
            <p>Self-exclusion: available</p>
            <p>Play responsibly.</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">
              Legal
            </p>
            <p className="mt-3">Terms of service</p>
            <p>Privacy policy</p>
            <p>Contest rules</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
