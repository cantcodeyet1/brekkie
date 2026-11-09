import { createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, useLocation } from 'react-router-dom';
import { Wordmark } from '../ui.jsx';

/* The blue side and the page behind Sign in and Sign up. It stays mounted while you switch between the two,
   so only the words and the white sheet change. Each page puts its own hero text in through <HeroText>. */
const Slot = createContext(null);

export function HeroText({ children }) {
  const slot = useContext(Slot);
  return slot ? createPortal(children, slot) : null;
}

export default function AuthFrame() {
  const [slot, setSlot] = useState(null);
  const wiz = useLocation().pathname.startsWith('/start/club');
  return (
    <div className={'land' + (wiz ? ' wiz' : '')}>
      <section className="land-hero">
        <Wordmark className="wm-light" />
        <div className="hero-slot" ref={setSlot} />
      </section>
      <Slot.Provider value={slot}><Outlet /></Slot.Provider>
    </div>
  );
}
