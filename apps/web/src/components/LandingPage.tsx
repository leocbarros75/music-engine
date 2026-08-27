import { useEffect, useRef } from "react";
import "../landing.css";

interface LandingPageProps {
  onEnterStudio: () => void;
}

/** The hero score stack — the product's claim rendered in its own material. */
const STAVES: Array<{ name: string; fam: string; lead?: boolean; density: number }> = [
  { name: "Lead sheet", fam: "var(--lp-paper)", lead: true, density: 7 },
  { name: "Flute",      fam: "var(--lp-ww)",    density: 6 },
  { name: "Oboe",       fam: "var(--lp-ww)",    density: 5 },
  { name: "Clarinet",   fam: "var(--lp-ww)",    density: 6 },
  { name: "Bassoon",    fam: "var(--lp-ww)",    density: 4 },
  { name: "Horn 1-2",   fam: "var(--lp-gold)",  density: 4 },
  { name: "Horn 3-4",   fam: "var(--lp-gold)",  density: 3 },
  { name: "Trumpet",    fam: "var(--lp-gold)",  density: 3 },
  { name: "Trombone",   fam: "var(--lp-gold)",  density: 3 },
  { name: "Tuba",       fam: "var(--lp-gold)",  density: 2 },
  { name: "Timpani",    fam: "var(--lp-perc)",  density: 2 },
  { name: "Violin I",   fam: "var(--lp-str)",   density: 8 },
  { name: "Violin II",  fam: "var(--lp-str)",   density: 7 },
  { name: "Viola",      fam: "var(--lp-str)",   density: 6 },
  { name: "Cello",      fam: "var(--lp-str)",   density: 5 },
  { name: "Contrabass", fam: "var(--lp-str)",   density: 3 },
];

const ENSEMBLES: Array<{ parts: string; title: string; desc: string; fam: string }> = [
  { parts: "4 voices",   title: "Choral SATB",         fam: "var(--lp-str)",  desc: "Four-voice writing with classical voice-leading, or free counterpoint." },
  { parts: "Grand staff",title: "Piano",               fam: "var(--lp-perc)", desc: "Idiomatic reductions, or melody over a left-hand pattern you choose." },
  { parts: "5 parts",    title: "Strings",             fam: "var(--lp-str)",  desc: "Quartet and quintet textures with adaptive rhythmic writing." },
  { parts: "4–5 parts",  title: "Woodwinds",           fam: "var(--lp-ww)",   desc: "Flute, oboe, clarinet, bassoon — balanced by register, not by rule." },
  { parts: "5 parts",    title: "Brass",               fam: "var(--lp-gold)", desc: "Quartet through quintet, concert or fanfare scoring." },
  { parts: "14 parts",   title: "Worship Orchestra",   fam: "var(--lp-gold)", desc: "The PraiseCharts layout, sax substitutions included, so any church can cover it." },
  { parts: "12–15 parts",title: "Symphonic Orchestra", fam: "var(--lp-str)",  desc: "Classical or Romantic period — the roster and the scoring both change." },
];

const RECEIPTS: Array<{ src: string; str: string; ww: string; br: string; engine?: boolean }> = [
  { src: "Six PraiseCharts orchestrations", str: "36%", ww: "16%", br: "48%" },
  { src: "→ Worship engine",                str: "36%", ww: "16%", br: "47%", engine: true },
  { src: "Brahms, Symphony No. 3",          str: "50%", ww: "38%", br: "12%" },
  { src: "Dvořák, Symphony No. 9",          str: "32%", ww: "43%", br: "25%" },
  { src: "→ Symphonic engine",              str: "51%", ww: "28%", br: "21%", engine: true },
];

export default function LandingPage({ onEnterStudio }: LandingPageProps) {
  const stackRef = useRef<HTMLDivElement>(null);

  // Build the stave graphics imperatively — generated geometry rather than
  // hand-authored markup, so the staff lines stay crisp at any width.
  useEffect(() => {
    const host = stackRef.current;
    if (!host) return;
    host.innerHTML = "";

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const NS = "http://www.w3.org/2000/svg";

    STAVES.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "lp-stave" + (s.lead ? " is-lead" : "");
      row.style.animationDelay = reduce ? "0s" : `${0.18 + i * 0.075}s`;

      const label = document.createElement("div");
      label.className = "lp-stave-name";
      label.textContent = s.name;

      const h = s.lead ? 34 : 26;
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "lp-stave-svg");
      svg.setAttribute("viewBox", `0 0 1000 ${h}`);
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("aria-hidden", "true");

      for (let l = 0; l < 5; l++) {
        const line = document.createElementNS(NS, "rect");
        line.setAttribute("x", "0");
        line.setAttribute("y", String(h / 2 - 8 + l * 4));
        line.setAttribute("width", "1000");
        line.setAttribute("height", "0.6");
        line.setAttribute("fill", s.lead ? "#2C3A54" : "#1D283C");
        svg.appendChild(line);
      }

      for (let k = 0; k < s.density; k++) {
        const note = document.createElementNS(NS, "ellipse");
        note.setAttribute("cx", String(40 + k * (920 / s.density) + ((k * 37) % 23)));
        note.setAttribute("cy", String(h / 2 - 6 + ((k * 5) % 13)));
        note.setAttribute("rx", s.lead ? "5.2" : "4.2");
        note.setAttribute("ry", s.lead ? "3.7" : "3.1");
        note.setAttribute("fill", s.fam);
        note.setAttribute("opacity", s.lead ? "1" : "0.85");
        svg.appendChild(note);
      }

      row.appendChild(label);
      row.appendChild(svg);
      host.appendChild(row);
    });
  }, []);

  return (
    <div className="lp">
      <div className="lp-sheet">

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <header className="lp-hero">
          <div className="lp-eyebrow">Music Engine Studio</div>
          <h1>
            One melody in.<br />
            A <em>full orchestra</em> out.
          </h1>
          <p className="lp-lede">
            Upload a lead sheet, a chord chart, or a PDF rhythm chart. Get back a
            playable, engraved arrangement — choir, piano, strings, winds, brass,
            worship orchestra, or full symphonic orchestra.
          </p>
          <div className="lp-cta-row">
            <button className="lp-btn" onClick={onEnterStudio}>Open the Studio</button>
            <span className="lp-cta-note">Free · no account · exports MusicXML &amp; MIDI</span>
          </div>
        </header>

        <div
          className="lp-stack"
          ref={stackRef}
          role="img"
          aria-label="A lead sheet melody expanding into a full orchestral score"
        />

        {/* ── Credibility ───────────────────────────────────────────────── */}
        <section className="lp-system">
          <div className="lp-rail"><b>Behind it</b>The engine</div>
          <div>
            <p className="lp-credit-line">Built by an orchestral conductor, not a generic model.</p>
            <dl className="lp-facts">
              <div className="lp-fact">
                <dt>Trained</dt>
                <dd>M.M. Orchestra Conducting, Campbellsville University. Doctoral coursework in Choral Conducting, Southwestern Baptist Theological Seminary.</dd>
              </div>
              <div className="lp-fact">
                <dt>Taught</dt>
                <dd>Eight years of university faculty in Rio de Janeiro — orchestral and choral conducting, theory, music history.</dd>
              </div>
              <div className="lp-fact">
                <dt>Practising</dt>
                <dd>Twenty years leading choirs and orchestras across two countries — these arrangements get played on Sunday.</dd>
              </div>
            </dl>
          </div>
        </section>

        {/* ── Ensembles ─────────────────────────────────────────────────── */}
        <section className="lp-system">
          <div className="lp-rail"><b>Ensembles</b>Seven engines</div>
          <div>
            <h2 className="lp-h2">Each ensemble is its own engine.</h2>
            <p className="lp-intro">
              Not one arranger with different instrument labels. A worship orchestra is
              brass-forward and leaves room for the band; a symphonic orchestra is
              strings-led and self-contained. They are written, and calibrated, separately.
            </p>
            <div className="lp-ens-grid">
              {ENSEMBLES.map((e) => (
                <article
                  key={e.title}
                  className="lp-ens"
                  style={{ ["--lp-fam" as string]: e.fam }}
                >
                  <span className="lp-ens-parts">{e.parts}</span>
                  <h3>{e.title}</h3>
                  <p>{e.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Calibration receipts ──────────────────────────────────────── */}
        <section className="lp-system">
          <div className="lp-rail"><b>Calibration</b>Measured</div>
          <div>
            <h2 className="lp-h2">Calibrated against real scores.</h2>
            <p className="lp-intro">
              The balance between families isn't a guess. Each engine was measured against
              published orchestrations and tuned to match them — then measured again.
            </p>

            <div className="lp-receipts">
              <table>
                <caption>Share of the texture carried by each family, measured by note count.</caption>
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Strings</th>
                    <th scope="col">Winds</th>
                    <th scope="col">Brass</th>
                  </tr>
                </thead>
                <tbody>
                  {RECEIPTS.map((r) => (
                    <tr key={r.src} className={r.engine ? "lp-row-engine" : undefined}>
                      <td>{r.src}</td>
                      <td className="is-str">{r.str}</td>
                      <td className="is-ww">{r.ww}</td>
                      <td className="is-br">{r.br}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="lp-note">
              <b>Why it matters.</b> Brass carries a worship chart; strings carry a symphony.
              An engine that doesn't know the difference writes the same music twice and
              calls it two ensembles.
            </p>
          </div>
        </section>

        {/* ── How it works ──────────────────────────────────────────────── */}
        <section className="lp-system">
          <div className="lp-rail"><b>Workflow</b>Three steps</div>
          <div>
            <h2 className="lp-h2">From a single line to a full score.</h2>
            <div className="lp-steps">
              <div className="lp-step">
                <div className="lp-step-n">01</div>
                <div>
                  <h3>Bring what you have</h3>
                  <p>
                    A <code>.musicxml</code> export from Finale, Sibelius or MuseScore — or a
                    printed chord chart as PDF, read straight from the page. No chords in the
                    file? The engine infers the harmony from the melody.
                  </p>
                </div>
              </div>
              <div className="lp-step">
                <div className="lp-step-n">02</div>
                <div>
                  <h3>Choose the ensemble you actually have</h3>
                  <p>
                    Pick the players in the room, bias the family balance, set how the
                    arrangement builds — and, if you want, name the exact measures each
                    instrument plays.
                  </p>
                </div>
              </div>
              <div className="lp-step">
                <div className="lp-step-n">03</div>
                <div>
                  <h3>Hear it, then take it away</h3>
                  <p>
                    Play it back in the browser, then export <code>MusicXML</code> or{" "}
                    <code>MIDI</code> and open it in your notation software for the final polish.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Bio ───────────────────────────────────────────────────────── */}
        <section className="lp-system lp-bio">
          <div className="lp-rail"><b>Léo Barros</b>Music &amp; Worship Pastor</div>
          <div>
            <h2 className="lp-h2">Twenty years of standing in front of the orchestra.</h2>
            <p>
              <strong>Leonardo “Léo” Barros</strong> is a Brazilian-American music and worship
              pastor whose career spans more than two decades and two continents. Since 2021 he
              has served as Music and Worship Pastor at <strong>Immanuel Baptist Church</strong>{" "}
              in Temple, Texas — conducting choir and orchestra, leading worship in English and
              Brazilian Portuguese, teaching instruments, and running the church's broadcast and
              AV production.
            </p>
            <p>
              His training pairs classical rigour with a pastoral calling: bachelor's degrees in
              Church Music and Choral Conducting from <strong>UFRJ</strong> in Rio de Janeiro, a{" "}
              <strong>Master of Music in Orchestra Conducting</strong> from Campbellsville
              University, and doctoral coursework in Choral Conducting at Southwestern Baptist
              Theological Seminary. He plays violin, viola, cello, guitar, bass and drums, and
              writes and arranges original congregational songs, mostly in Portuguese.
            </p>
            <p>
              Before moving to the United States he spent eight years on the full-time music
              faculty at <strong>STBSB in Rio de Janeiro</strong>, teaching music history, theory,
              choral conducting, orchestral conducting and worship studies. He served at Armitage
              Baptist Church in Chicago from 2017 to 2021 before taking up his current post in
              Texas.
            </p>
            <p>
              Music Engine Studio came out of that work. Every church has more songs than it has
              orchestrators, and the arrangement is usually the thing that never gets written.
              This is the tool he wanted on a Tuesday afternoon with a Sunday service coming.
            </p>

            <div className="lp-cv">
              <div>
                <h4>Education</h4>
                <ul>
                  <li>M.M. Orchestra Conducting — Campbellsville University</li>
                  <li>Doctoral coursework, Choral Conducting — SWBTS</li>
                  <li>B.M. Church Music · B.M. Choral Conducting — UFRJ</li>
                </ul>
              </div>
              <div>
                <h4>Currently</h4>
                <ul>
                  <li>Music &amp; Worship Pastor, Immanuel Baptist Church, Temple TX</li>
                  <li>Church media consultant</li>
                  <li>Private strings and theory instruction</li>
                </ul>
              </div>
              <div>
                <h4>Instruments</h4>
                <ul>
                  <li>Violin · Viola · Cello</li>
                  <li>Guitar · Bass · Drums</li>
                  <li>Arranging, recording, production</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── Closer ────────────────────────────────────────────────────── */}
        <section className="lp-closer">
          <h2>Bring a melody. Leave with a score.</h2>
          <p>Free to use, no account required. Export to MusicXML or MIDI and finish it your way.</p>
          <button className="lp-btn" onClick={onEnterStudio}>Open the Studio</button>
        </section>

        <footer className="lp-footer">
          <span>Music Engine Studio — automated orchestration for working musicians.</span>
          <span>Built by Léo Barros · Temple, Texas</span>
        </footer>
      </div>
    </div>
  );
}
