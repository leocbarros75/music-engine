interface LandingPageProps {
  onEnterStudio: () => void;
}

const FEATURES = [
  {
    icon: "🎼",
    title: "SATB Choral",
    desc: "Four-voice choral harmony with classical voice-leading rules and optional counterpoint.",
  },
  {
    icon: "🎹",
    title: "Piano",
    desc: "Idiomatic piano reductions with Alberti bass, chord arpeggios, and melody-in-soprano styles.",
  },
  {
    icon: "🎻",
    title: "String Ensemble",
    desc: "Full string quartet and quintet with adaptive rhythmic textures and polyphonic motifs.",
  },
  {
    icon: "🪗",
    title: "Woodwind Ensemble",
    desc: "Flute, oboe, clarinet, and bassoon with idiomatic register balancing.",
  },
  {
    icon: "🎺",
    title: "Brass Ensemble",
    desc: "Trumpet, horn, trombone, and tuba scored for concert or marching contexts.",
  },
  {
    icon: "🎶",
    title: "Full Orchestra",
    desc: "Complete orchestral layout — strings, winds, brass, and timpani from a single melody.",
  },
];

const STEPS = [
  {
    number: "1",
    title: "Upload or type chords",
    desc: "Upload a .musicxml file from MuseScore, Finale, or Sibelius — or just type a chord progression like C Am F G.",
  },
  {
    number: "2",
    title: "Choose your ensemble",
    desc: "Pick from SATB choir, piano, strings, woodwinds, brass, or full orchestra. Fine-tune style, key, tempo, and voice activity.",
  },
  {
    number: "3",
    title: "Export your arrangement",
    desc: "Download the rendered MusicXML, SVG score, or MIDI file — ready to import into any notation or DAW software.",
  },
];

export default function LandingPage({ onEnterStudio }: LandingPageProps) {
  return (
    <div className="landing">
      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-badge">AI-powered music arrangement</div>
          <h1 className="hero-title">
            Turn any melody into a<br />
            <span className="hero-accent">full arrangement</span>
          </h1>
          <p className="hero-subtitle">
            Upload a MusicXML file or type chord symbols and get a professional
            arrangement for choir, piano, strings, woodwinds, brass, or orchestra
            in seconds.
          </p>
          <div className="hero-cta-row">
            <button className="primary large hero-cta" onClick={onEnterStudio}>
              Open Studio →
            </button>
            <span className="hero-cta-note">Free · No account required</span>
          </div>
        </div>

        {/* Decorative score lines */}
        <div className="hero-deco" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="hero-staff-line" />
          ))}
        </div>
      </section>

      {/* ── Features grid ───────────────────────────────────────────── */}
      <section className="features-section">
        <div className="section-inner">
          <h2 className="section-heading">Six ensemble types, one tool</h2>
          <p className="section-subheading">
            Each ensemble uses purpose-built voice-leading algorithms, not just transposition.
          </p>
          <div className="features-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="feature-card">
                <span className="feature-icon">{f.icon}</span>
                <h3 className="feature-title">{f.title}</h3>
                <p className="feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────── */}
      <section className="how-section">
        <div className="section-inner">
          <h2 className="section-heading">How it works</h2>
          <div className="how-steps">
            {STEPS.map((s) => (
              <div key={s.number} className="how-step">
                <div className="step-number">{s.number}</div>
                <div className="step-body">
                  <h3 className="step-title">{s.title}</h3>
                  <p className="step-desc">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Format badges ───────────────────────────────────────────── */}
      <section className="formats-section">
        <div className="section-inner formats-inner">
          <p className="formats-label">Export formats</p>
          <div className="formats-list">
            {["MusicXML", "SVG Score", "PDF", "MIDI Type 1"].map((f) => (
              <span key={f} className="format-badge">{f}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ──────────────────────────────────────────────── */}
      <section className="bottom-cta-section">
        <div className="section-inner bottom-cta-inner">
          <h2 className="bottom-cta-title">Ready to arrange?</h2>
          <p className="bottom-cta-sub">No sign-up. Works in your browser.</p>
          <button className="primary large" onClick={onEnterStudio}>
            Open Studio →
          </button>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <span>Music Engine Studio</span>
        <span className="footer-sep">·</span>
        <span>Built with TypeScript + React</span>
      </footer>
    </div>
  );
}
