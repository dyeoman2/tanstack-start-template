import * as React from 'react';
import { createPortal } from 'react-dom';

interface SimpleTooltipProps {
  children: React.ReactNode;
  // Tooltip content. If empty/whitespace/undefined, tooltip will not render.
  content?: React.ReactNode;
  cursor?: string;
}

export function SimpleTooltip({ children, content, cursor }: SimpleTooltipProps) {
  const [isVisible, setIsVisible] = React.useState(false);
  // Anchor stores the trigger's centerX, top and bottom for placement calculations
  const [anchor, setAnchor] = React.useState({ centerX: 0, top: 0, bottom: 0 });
  const [triggerElement, setTriggerElement] = React.useState<HTMLElement | null>(null);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const [tooltipSize, setTooltipSize] = React.useState({ width: 0, height: 0 });

  // Create or get tooltip container
  const getTooltipContainer = () => {
    let container = document.getElementById('tooltip-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'tooltip-container';
      container.style.position = 'fixed';
      container.style.top = '0';
      container.style.left = '0';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '999999';
      document.body.appendChild(container);
    }
    return container;
  };

  const updateAnchor = React.useCallback(() => {
    if (!triggerElement) return;
    const rect = triggerElement.getBoundingClientRect();
    setAnchor({ centerX: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom });
  }, [triggerElement]);

  const handleMouseEnter = () => {
    updateAnchor();
    setIsVisible(true);
  };

  const handleMouseLeave = () => {
    setIsVisible(false);
  };

  React.useEffect(() => {
    if (!isVisible) return;
    const measure = () => {
      const el = tooltipRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setTooltipSize({ width: rect.width, height: rect.height });
    };
    // Measure on next paint
    const raf = requestAnimationFrame(measure);
    // Keep tooltip positioned on resize/scroll
    const onResize = () => {
      updateAnchor();
      measure();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [isVisible, updateAnchor]);

  // Compute safe, clamped position inside the viewport
  const margin = 8;
  const width = tooltipSize.width || 240; // sensible defaults before first measure
  const height = tooltipSize.height || 40;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const hasRoomAbove = anchor.top >= height + margin + 2;
  const desiredTop = hasRoomAbove ? anchor.top - margin - height : anchor.bottom + margin;
  const clampedTop = Math.max(margin, Math.min(desiredTop, vh - margin - height));
  const clampedCenterX = Math.max(
    margin + width / 2,
    Math.min(anchor.centerX, vw - margin - width / 2),
  );

  // Determine if there is meaningful content to show. Strings must be non-empty
  // when trimmed; null/undefined/false are treated as empty.
  const hasContent = React.useMemo(() => {
    if (content === null || content === undefined || content === false) return false;
    if (typeof content === 'string') return content.trim().length > 0;
    return true; // Elements, numbers, etc.
  }, [content]);

  // Check if children contain interactive elements (button, input, select, etc.)
  const hasInteractiveChildren = React.useMemo(() => {
    const checkInteractive = (node: React.ReactNode): boolean => {
      if (React.isValidElement(node)) {
        // Check if this element is an HTML interactive element
        if (typeof node.type === 'string') {
          const interactiveTags = ['button', 'input', 'select', 'textarea', 'a'];
          if (interactiveTags.includes(node.type)) {
            return true;
          }
        }

        // Check if this is a custom component that might render interactive elements
        if (typeof node.type === 'function' || typeof node.type === 'object') {
          // Check component name/displayName for common interactive patterns
          const componentType = node.type as
            | React.ComponentType<Record<string, unknown>>
            | React.FunctionComponent<Record<string, unknown>>;
          const componentName = componentType.displayName || componentType.name || '';
          if (
            componentName.toLowerCase().includes('button') ||
            componentName.toLowerCase().includes('input') ||
            componentName.toLowerCase().includes('select') ||
            componentName.toLowerCase().includes('link')
          ) {
            return true;
          }
        }

        // Check if this element has interactive props
        const props = node.props as Record<string, unknown>;
        if (
          props?.onClick ||
          props?.onKeyDown ||
          props?.onKeyUp ||
          props?.onMouseDown ||
          props?.onMouseUp ||
          props?.tabIndex !== undefined ||
          props?.role === 'button' ||
          props?.role === 'link' ||
          props?.role === 'menuitem'
        ) {
          return true;
        }

        // Recursively check children
        if (props?.children) {
          return React.Children.toArray(props.children as React.ReactNode[]).some(checkInteractive);
        }
      }
      return false;
    };

    return React.Children.toArray(children).some(checkInteractive);
  }, [children]);

  // If there's nothing to show, avoid rendering the interactive wrapper entirely.
  if (!hasContent) {
    return <>{children}</>;
  }

  // Use div wrapper if children are interactive to avoid nested buttons
  const Wrapper = hasInteractiveChildren ? 'div' : 'button';

  return (
    <>
      <Wrapper
        ref={setTriggerElement}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="inline-block bg-card p-0 m-0 border-0"
        style={cursor ? { cursor } : undefined}
        onFocus={handleMouseEnter}
        onBlur={handleMouseLeave}
        {...(hasInteractiveChildren ? {} : { type: 'button' as const })}
      >
        {children}
      </Wrapper>
      {isVisible &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={tooltipRef}
            style={{
              position: 'fixed',
              left: clampedCenterX,
              top: clampedTop,
              transform: 'translateX(-50%)',
              zIndex: 999999,
              padding: '6px 12px',
              fontSize: '12px',
              color: 'white',
              backgroundColor: '#1f2937',
              borderRadius: '6px',
              boxShadow:
                '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid #374151',
              maxWidth: '300px',
              whiteSpace: 'pre-line',
              pointerEvents: 'none',
            }}
          >
            {content}
          </div>,
          getTooltipContainer(),
        )}
    </>
  );
}
