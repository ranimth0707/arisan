import { useState } from "react";
import { Icon, type Navigate } from "./UI";

const steps = [
  { title: "Start with one group.", detail: "Example: you, Bima, and Citra agree to contribute 10 COOK per round. Each person locks 30 COOK (10 × 3 rounds) as a reserve, not an extra fee.", action: "Try a contribution" },
  { title: "Contributions enter the shared pool.", detail: "Three members × 10 COOK = 30 COOK. The reserve is held separately. If someone misses a payment, the program uses their reserve so the pool stays at 30 COOK.", action: "See a draw example" },
  { title: "One person gets the turn.", detail: "In this example, the turn goes to you. In a live campaign, the program determines the draw. The recipient must meet the payment and reserve requirements.", action: "Try collecting a turn" },
  { title: "Your turn ends, contributions continue.", detail: "You receive 30 COOK. You still contribute 10 COOK in the next rounds, but you do not draw again. The Arisan ends after everyone has received a turn.", action: "Replay the simulation" },
];
export function Guide({ navigate }: { navigate: Navigate }) {
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<"member" | "creator">("member");
  return <>
    <section className="simulation" aria-label="Arisan simulation">
      <div className="simulation-visual">
        <span className="pill closed">Simulation · not a real transaction</span>
        <span className="pot-label">{step === 3 ? "You receive" : "Round 1 pool"}</span>
        <div className="pot-amount">{step === 0 ? "0" : "30"} <span>COOK</span></div>
        <div className="demo-members">{["You", "Bima", "Citra"].map((name, i) => <div key={name} className={i === 0 && step >= 2 ? "demo-member selected" : "demo-member"}>
          <span className="avatar">{name[0]}</span><strong>{name}</strong><small>{step === 0 ? "Not paid yet" : step >= 2 && i === 0 ? (step === 3 ? "Received" : "Turn selected") : "Contribute 10 COOK"}</small>
        </div>)}</div>
      </div>
      <div className="simulation-copy">
        <span className="step-count">STEP {step + 1} OF 4</span>
        <div className="step-progress" aria-hidden="true">{steps.map((_, i) => <span key={i} className={i <= step ? "done" : ""} />)}</div>
        <div className="step-copy" aria-live="polite" key={step}><h2>{steps[step].title}</h2><p>{steps[step].detail}</p></div>
        <button className="primary" onClick={() => setStep((step + 1) % 4)}>{steps[step].action}<Icon name="arrow" /></button>
        <small>This simulation does not connect a wallet or move funds.</small>
      </div>
    </section>
    <section className="guide-section">
      <h2>Where do I start?</h2>
      <div className="segmented" aria-label="Choose a guide"><button aria-pressed={role === "member"} onClick={() => setRole("member")}>I want to join</button><button aria-pressed={role === "creator"} onClick={() => setRole("creator")}>I want to create</button></div>
      <ol className="guide-steps">
        {(role === "member" ? [
          ["Ask the creator for the code", "The code opens the campaign you were invited to. Read the group's purpose, creator's post, contribution, and duration before joining."],
          ["Connect a wallet and get COOK", "To try it, open Get demo COOK. Your balance covers the reserve and contributions, not just gas."],
          ["Join the room and wait for the creator", "Joining moves the reserve from your wallet. It equals the contribution × the number of members. The creator starts the Arisan after at least two members join."],
          ["Pay every round", "Contribute until everyone gets a turn, including after you receive the pool. Watch the deadline and ledger in the room."],
        ] : [
          ["Add campaign details", "Name the campaign and explain who can join and what the Arisan is for."],
          ["Agree on the rules", "Set the contribution, reserve, member count, and round duration. The rules cannot change after creation."],
          ["Share the code", "Creating the campaign gives you a group code. Send it to the people you want in — WhatsApp, Telegram, in person. Nothing is published, and anyone holding the code can join, so it is only as private as you keep it."],
          ["Create the room and invite your group", "Connect a wallet, review the rules, then create the campaign. The creator automatically becomes the first member; save and share the generated code."],
        ]).map(([title, detail], i) => <li key={title}><span>{i + 1}</span><div><h3>{title}</h3><p>{detail}</p></div></li>)}
      </ol>
      <button className="primary" onClick={() => navigate(role === "member" ? "join" : "create")}>{role === "member" ? "I have a code" : "Create campaign"}<Icon name="arrow" /></button>
    </section>
    <section className="faq"><h2>What you should know</h2>
      <details><summary>What is the difference between the reserve and a contribution?</summary><p>The reserve is locked when you join and held separately from the pool. For new campaigns, it must be at least the contribution × the number of members, so remaining obligations can be covered. Contributions are paid every round to build the pool. Unused reserve can be withdrawn after the Arisan ends.</p></details>
      <details><summary>What happens if someone does not pay?</summary><p>After the deadline, anyone can cover the missed contribution from that member's reserve. Their reserve balance decreases, but the round pool stays whole. If the reserves are not sufficient, the program locks the draw and payout until the shortfall is repaired—other members are never forced to cover it.</p></details>
      <details><summary>Does the demo use real money?</summary><p>The simulation above is only an example. Get demo COOK and campaigns in the app use real transactions on Cookie Chain mainnet. Check the amount before approving a wallet transaction.</p></details>
      <details><summary>Does the code restrict who can join?</summary><p>Not completely. The app asks for a code to open a room, but the current blockchain program does not have strong membership authorization. Technical users may bypass the app-level code gate. Details and the ledger are public, so do not treat the code as a privacy or identity guarantee.</p></details>
    </section>
  </>;
}
