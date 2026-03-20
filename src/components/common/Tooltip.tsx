import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  delay?: number;
  position?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export function Tooltip({ content, children, delay = 300, position = "bottom", className }: TooltipProps) {
  const [show, setShow] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        // A simple estimation for tooltip placement
        let x = rect.left + rect.width / 2;
        let y = rect.bottom + 6; // default bottom
        
        switch (position) {
          case 'top':
            y = rect.top - 6;
            break;
          case 'left':
            x = rect.left - 6;
            y = rect.top + rect.height / 2;
            break;
          case 'right':
            x = rect.right + 6;
            y = rect.top + rect.height / 2;
            break;
        }
        
        setCoords({ x, y });
        setShow(true);
      }
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShow(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!content) return <>{children}</>;

  return (
    <>
      <div 
        ref={triggerRef} 
        onMouseEnter={handleMouseEnter} 
        onMouseLeave={handleMouseLeave}
        className="inline-flex w-full h-full"
      >
        {children}
      </div>
      {createPortal(
        <AnimatePresence>
          {show && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              style={{
                position: "fixed",
                top: coords.y,
                left: coords.x,
                transform: position === 'top' ? "translate(-50%, -100%)" :
                           position === 'bottom' ? "translate(-50%, 0)" :
                           position === 'left' ? "translate(-100%, -50%)" : "translate(0, -50%)",
                zIndex: 9999,
                pointerEvents: "none",
              }}
              className={cn(
                "px-2 py-1 text-[11px] font-medium text-white bg-gray-800 dark:bg-gray-700/90 rounded shadow-md whitespace-nowrap",
                className
              )}
            >
              {content}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
