import { useChatStore } from '../../stores/chat';

const stateStyles = {
  idle: {
    orb: 'bg-[radial-gradient(circle_at_35%_35%,rgba(0,220,255,0.4),rgba(0,180,216,0.15)_50%,rgba(0,60,100,0.1))] shadow-[0_0_30px_rgba(0,180,216,0.3),0_0_60px_rgba(0,180,216,0.15),inset_0_0_30px_rgba(0,180,216,0.2)] animate-orb-pulse',
    ring1: 'border-[rgba(0,180,216,0.2)] animate-ring-rotate',
    ring2: 'border-[rgba(124,58,237,0.2)] animate-ring-rotate [animation-direction:reverse]',
    ring3: 'border-[rgba(0,180,216,0.1)] animate-ring-rotate',
    bracket: 'border-jarvis-cyan-dim',
    label: 'text-jarvis-fg-dim',
    labelText: 'STANDING BY',
  },
  passive: {
    orb: 'bg-[radial-gradient(circle_at_35%_35%,rgba(34,197,94,0.3),rgba(0,180,216,0.15)_50%,rgba(0,60,100,0.1))] shadow-[0_0_30px_rgba(34,197,94,0.2),0_0_60px_rgba(34,197,94,0.1),inset_0_0_30px_rgba(34,197,94,0.15)] animate-orb-pulse',
    ring1: 'border-[rgba(0,180,216,0.2)] animate-ring-rotate',
    ring2: 'border-[rgba(124,58,237,0.2)] animate-ring-rotate [animation-direction:reverse]',
    ring3: 'border-[rgba(0,180,216,0.1)] animate-ring-rotate',
    bracket: 'border-jarvis-cyan-dim',
    label: 'text-jarvis-green',
    labelText: 'LISTENING',
  },
  active: {
    orb: 'bg-[radial-gradient(circle_at_35%_35%,rgba(0,220,255,0.4),rgba(0,180,216,0.15)_50%,rgba(0,60,100,0.1))] shadow-[0_0_40px_rgba(0,180,216,0.5),0_0_80px_rgba(0,180,216,0.25),inset_0_0_30px_rgba(0,180,216,0.3)] animate-orb-pulse-fast',
    ring1: 'border-[rgba(0,180,216,0.2)] animate-ring-rotate-fast',
    ring2: 'border-[rgba(124,58,237,0.2)] animate-ring-rotate-fast [animation-direction:reverse]',
    ring3: 'border-[rgba(0,180,216,0.1)] animate-ring-rotate-fast',
    bracket: 'border-jarvis-cyan',
    label: 'text-jarvis-cyan',
    labelText: 'PROCESSING VOICE',
  },
  thinking: {
    orb: 'bg-[radial-gradient(circle_at_35%_35%,rgba(245,158,11,0.4),rgba(245,158,11,0.15)_50%,rgba(100,60,0,0.1))] shadow-[0_0_40px_rgba(245,158,11,0.4),0_0_80px_rgba(245,158,11,0.2),inset_0_0_30px_rgba(245,158,11,0.25)] animate-orb-pulse-think',
    ring1: 'border-[rgba(245,158,11,0.3)] animate-ring-rotate-think',
    ring2: 'border-[rgba(124,58,237,0.2)] animate-ring-rotate-think [animation-direction:reverse]',
    ring3: 'border-[rgba(0,180,216,0.1)] animate-ring-rotate-think',
    bracket: 'border-jarvis-cyan-dim',
    label: 'text-jarvis-amber',
    labelText: 'THINKING',
  },
  speaking: {
    orb: 'bg-[radial-gradient(circle_at_35%_35%,rgba(124,58,237,0.4),rgba(0,180,216,0.2)_50%,rgba(60,0,100,0.1))] shadow-[0_0_50px_rgba(124,58,237,0.3),0_0_100px_rgba(0,180,216,0.15),inset_0_0_30px_rgba(124,58,237,0.2)] animate-orb-pulse',
    ring1: 'border-[rgba(0,180,216,0.2)] animate-ring-rotate',
    ring2: 'border-[rgba(124,58,237,0.3)] animate-ring-rotate [animation-direction:reverse]',
    ring3: 'border-[rgba(0,180,216,0.1)] animate-ring-rotate',
    bracket: 'border-jarvis-cyan-dim',
    label: 'text-jarvis-purple',
    labelText: 'SPEAKING',
  },
};

export default function CoreOrb() {
  const coreState = useChatStore((s) => s.coreState);
  const styles = stateStyles[coreState] || stateStyles.idle;

  return (
    <div className="flex flex-col items-center py-8 md:py-6 flex-shrink-0">
      <div className="w-[180px] h-[180px] relative flex items-center justify-center md:w-[140px] md:h-[140px]">
        {/* Corner brackets */}
        <div className={`absolute w-5 h-5 border-solid border-0 border-t border-l top-[-5px] left-[-5px] ${styles.bracket} transition-colors duration-500`} />
        <div className={`absolute w-5 h-5 border-solid border-0 border-t border-r top-[-5px] right-[-5px] ${styles.bracket} transition-colors duration-500`} />
        <div className={`absolute w-5 h-5 border-solid border-0 border-b border-l bottom-[-5px] left-[-5px] ${styles.bracket} transition-colors duration-500`} />
        <div className={`absolute w-5 h-5 border-solid border-0 border-b border-r bottom-[-5px] right-[-5px] ${styles.bracket} transition-colors duration-500`} />

        {/* Rings */}
        <div className={`absolute w-[175px] h-[175px] rounded-full border border-dotted ${styles.ring3} md:w-[135px] md:h-[135px]`} style={{ animationDuration: '25s' }} />
        <div className={`absolute w-[150px] h-[150px] rounded-full border border-dashed ${styles.ring2} md:w-[115px] md:h-[115px]`} style={{ animationDuration: '15s' }} />
        <div className={`absolute w-[120px] h-[120px] rounded-full border border-solid ${styles.ring1} md:w-[95px] md:h-[95px]`} style={{ animationDuration: '20s' }} />

        {/* Orb */}
        <div className={`w-[90px] h-[90px] rounded-full absolute transition-all duration-500 md:w-[70px] md:h-[70px] ${styles.orb}`} />
      </div>

      {/* State label */}
      <div className={`mt-4 font-mono text-[0.65rem] tracking-[0.15em] uppercase text-center transition-colors duration-300 min-h-[1.2em] ${styles.label}`}>
        {styles.labelText}
      </div>
    </div>
  );
}
