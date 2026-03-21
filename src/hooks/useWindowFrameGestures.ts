import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const DRAG_THRESHOLD = 4;

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest(".no-drag"));
}

export function useWindowFrameGestures() {
  const pointerStateRef = useRef({
    active: false,
    clientX: 0,
    clientY: 0,
  });

  const clearPointerState = useCallback(() => {
    pointerStateRef.current.active = false;
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const pointerState = pointerStateRef.current;
      if (!pointerState.active || (event.buttons & 1) !== 1) {
        return;
      }

      const movedEnough =
        Math.abs(event.clientX - pointerState.clientX) >= DRAG_THRESHOLD
        || Math.abs(event.clientY - pointerState.clientY) >= DRAG_THRESHOLD;

      if (!movedEnough) {
        return;
      }

      pointerState.active = false;

      void getCurrentWindow().startDragging().catch(() => {
        // Ignore drag failures and fall back to no-op.
      });
    };

    const handleMouseUp = () => {
      clearPointerState();
    };

    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    window.addEventListener("blur", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
      window.removeEventListener("blur", handleMouseUp);
    };
  }, [clearPointerState]);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.detail > 1 || isInteractiveTarget(event.target)) {
      clearPointerState();
      return;
    }

    pointerStateRef.current = {
      active: true,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }, [clearPointerState]);

  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (isInteractiveTarget(event.target)) {
      return;
    }

    clearPointerState();
    event.preventDefault();

    void getCurrentWindow().toggleMaximize().catch(() => {
      // Ignore maximize failures and keep the title bar interactive.
    });
  }, [clearPointerState]);

  return {
    onMouseDown: handleMouseDown,
    onDoubleClick: handleDoubleClick,
  };
}
