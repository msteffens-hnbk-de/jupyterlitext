import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { MarkdownCell } from '@jupyterlab/cells';

/**
 * NeME Live Markdown Extension for JupyterLite
 * Complete NeME-like experience:
 * - Dark NeME Floating Toolbar with SVG icons & dropdowns
 * - Interactive Table Grid Editor (create, edit in-place, alignments, live preview)
 * - Interactive KaTeX Math Formula Builder (chips, live preview, in-place update)
 * - Hover 'Tabelle bearbeiten' on rendered tables & 'Formel bearbeiten' on formulas
 * - NeME Callout styler (> [!NOTE], [!TIP], [!WARNING], [!CAUTION], [!IMPORTANT])
 */
const extension: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlite-neme-markdown:plugin',
  description: 'NeME Markdown Toolbar, Interactive Tables, Math Formula Editor and Callouts for JupyterLite',
  autoStart: true,
  optional: [INotebookTracker],
  activate: (app: JupyterFrontEnd, tracker: INotebookTracker | null) => {
    console.log('[NeME Extension] Geladen und aktiv!');

    // CSS-Stile für NeME Dark Theme verankern
    injectStyles();
    loadKaTeXScript();

    // Start-Hinweis
    showNemeToast('NeME Markdown aktiv!');

    const setupNotebook = (notebookPanel: NotebookPanel) => {
      if (!notebookPanel || (notebookPanel as any)._obsidianObserved) return;
      (notebookPanel as any)._obsidianObserved = true;

      // Initiale Transformationen nach dem Laden
      setTimeout(() => transformRenderedMarkdown(notebookPanel), 300);
      setTimeout(() => transformRenderedMarkdown(notebookPanel), 900);

      // Wenn eine Zelle aktiv wird:
      notebookPanel.content.activeCellChanged.connect((_, cell) => {
        document.querySelectorAll('.obsidian-floating-toolbar').forEach(el => el.remove());
        if (cell && (cell.model?.type === 'markdown' || (cell as any).cellType === 'markdown' || cell.node.classList.contains('jp-MarkdownCell'))) {
          attachNemeToolbar(cell as MarkdownCell);
        } else if (cell && (cell.model?.type === 'code' || (cell as any).cellType === 'code' || cell.node.classList.contains('jp-CodeCell'))) {
          attachCodeCellToolbar(cell, notebookPanel, app);
        }
        setTimeout(() => transformRenderedMarkdown(notebookPanel), 100);
      });

      // Modus-Synchronisation auf Notebook-Ebene (Command Mode vs. Edit Mode)
      if ((notebookPanel.content as any).stateChanged) {
        try {
          (notebookPanel.content as any).stateChanged.connect((_: any, args: any) => {
            if (args && args.name === 'mode') {
              const activeCell = notebookPanel.content.activeCell as MarkdownCell | null;
              if (activeCell && (activeCell.model?.type === 'markdown' || (activeCell as any).cellType === 'markdown' || activeCell.node.classList.contains('jp-MarkdownCell'))) {
                if (args.newValue === 'edit' && activeCell.rendered === false) {
                  if ((activeCell as any)._obsidianMode === 'rendered') {
                    const nextMode = (activeCell as any)._lastEditMode || 'source';
                    setCellEditorMode(activeCell, nextMode);
                  }
                } else if (args.newValue === 'command' && activeCell.rendered) {
                  if ((activeCell as any)._obsidianMode !== 'rendered') {
                    setCellEditorMode(activeCell, 'rendered');
                  }
                }
              }
            }
          });
        } catch (_err) {}
      }

      // Beim Rendern oder Ändern von Markdown-Zellen Callouts, Tabellen und Formeln anreichern
      notebookPanel.content.model?.cells.changed.connect(() => {
        setTimeout(() => transformRenderedMarkdown(notebookPanel), 250);
      });

      // MutationObserver auf das Notebook-DOM zur lückenlosen Erkennung gerenderter Formeln & Tabellen
      try {
        const observer = new MutationObserver((mutations) => {
          let hasAdded = false;
          for (const m of mutations) {
            if (m.addedNodes.length > 0) {
              hasAdded = true;
              break;
            }
          }
          if (hasAdded) {
            transformRenderedMarkdown(notebookPanel);
          }
        });
        observer.observe(notebookPanel.node, { childList: true, subtree: true });
      } catch (_e) {
        // Fallback
      }

      // Variablen-Inspektor: Toolbar-Button verankern und Auto-Refresh bei Kernel-Ausführung registrieren
      setTimeout(() => attachVariableInspectorButton(notebookPanel), 400);
      if ((notebookPanel as any).sessionContext) {
        try {
          (notebookPanel as any).sessionContext.statusChanged.connect((_: any, status: string) => {
            if (status === 'idle') {
              updateVariableInspectorIfOpen(notebookPanel);
            }
          });
        } catch (_err) {}
      }
    };

    if (tracker) {
      tracker.widgetAdded.connect((_, notebookPanel: NotebookPanel) => {
        setupNotebook(notebookPanel);
      });
      tracker.forEach(nb => setupNotebook(nb));
      if (tracker.currentWidget) {
        setupNotebook(tracker.currentWidget);
      }
    }

    // Zusätzlicher Fallback-Intervall zur Sicherstellung, dass alle Formeln Buttons haben
    setInterval(() => {
      if (tracker?.currentWidget) {
        transformRenderedMarkdown(tracker.currentWidget);
      }
    }, 2000);
  }
};

/**
 * Verankert das vollständige NeME Dark Stylesheet im Browser
 */
function injectStyles(): void {
  if (document.getElementById('obsidian-extension-styles')) return;
  const styleEl = document.createElement('style');
  styleEl.id = 'obsidian-extension-styles';
  styleEl.textContent = `
    /* ========================================================= */
    /* NeME Card-Optik für alle Zellen in JupyterLite (Clean Card)*/
    /* ========================================================= */
    .jp-Notebook .jp-Cell {
      margin-top: 10px !important;
      margin-bottom: 16px !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 12px !important;
      background: #ffffff !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04) !important;
      overflow: visible !important; /* Verhindert das Abschneiden von Toolbar und Menüs */
      transition: border-color 0.15s ease, box-shadow 0.15s ease !important;
      padding: 8px 8px 12px 8px !important;
      min-height: 84px !important; /* Vorgeschriebene Mindesthöhe für neue & kleine Zellen */
      box-sizing: border-box !important;
    }

    /* Innenbereiche transparent halten – keine grauen Blöcke */
    .jp-Notebook .jp-Cell .jp-Cell-inputWrapper,
    .jp-Notebook .jp-Cell .jp-InputArea,
    .jp-Notebook .jp-Cell .jp-Editor,
    .jp-Notebook .jp-Cell .cm-editor,
    .jp-Notebook .jp-Cell .jp-RenderedHTMLCommon {
      background: transparent !important;
      outline: none !important;
      box-shadow: none !important;
    }

    /* Mindesthöhe für Eingabebereich & Editor, damit Toolbar & Inhalt nie gequetscht werden */
    .jp-Notebook .jp-Cell .jp-Cell-inputWrapper {
      padding-top: 6px !important;
      margin-top: 2px !important;
      min-height: 52px !important;
    }

    .jp-Notebook .jp-Cell .jp-InputArea {
      min-height: 48px !important;
    }

    .jp-Notebook .jp-Cell .jp-Editor,
    .jp-Notebook .jp-Cell .cm-editor {
      min-height: 44px !important;
    }

    .jp-Notebook .jp-Cell .jp-RenderedHTMLCommon {
      padding: 6px 12px !important;
      min-height: 40px !important;
    }

    /* Sanfter Hover-Effekt */
    .jp-Notebook .jp-Cell:hover {
      border-color: #cbd5e1 !important;
    }

    /* Aktive Markdown-Zelle (dezenter warmer Akzent, keine Balken) */
    .jp-Notebook .jp-MarkdownCell.jp-mod-active,
    .jp-Notebook .jp-MarkdownCell.jp-mod-selected {
      border-color: #f59e0b !important;
      box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2), 0 4px 12px rgba(245, 158, 11, 0.06) !important;
      background: #ffffff !important;
    }

    /* Aktive Python Code-Zelle: Dezent neutral statt grell-blau */
    .jp-Notebook .jp-CodeCell.jp-mod-active,
    .jp-Notebook .jp-CodeCell.jp-mod-selected {
      border-color: #94a3b8 !important;
      box-shadow: 0 0 0 2px rgba(148, 163, 184, 0.25), 0 4px 12px rgba(0, 0, 0, 0.06) !important;
      background: #ffffff !important;
    }

    /* ========================================================= */
    /* ALLE BLAUEN BALKEN & INDIKATOREN VOLLSTÄNDIG DEAKTIVIEREN */
    /* ========================================================= */
    /* 1. Pseudoelement-Balken (oben & links) komplett abschalten */
    .jp-Notebook .jp-Cell::before,
    .jp-Notebook .jp-Cell::after,
    .jp-Notebook-cell::before,
    .jp-Notebook-cell::after,
    .jp-Cell::before,
    .jp-Cell::after,
    .jp-Notebook .jp-Cell.jp-mod-active::before,
    .jp-Notebook .jp-Cell.jp-mod-active::after,
    .jp-Notebook .jp-Cell.jp-mod-selected::before,
    .jp-Notebook .jp-Cell.jp-mod-selected::after {
      display: none !important;
      content: none !important;
      height: 0 !important;
      width: 0 !important;
      border: none !important;
      background: transparent !important;
    }

    /* 2. Dicke Rahmen-Balken an aktiven Zellen zurücksetzen */
    .jp-Notebook .jp-Cell.jp-mod-active,
    .jp-Notebook .jp-Cell.jp-mod-selected,
    .jp-Notebook-cell.jp-mod-active,
    .jp-Notebook-cell.jp-mod-selected {
      border-top-width: 1px !important;
      border-left-width: 1px !important;
      outline: none !important;
    }

    /* 3. Blaue Klapp-/Collapser-Leisten am linken Rand ausblenden */
    .jp-Notebook .jp-Cell .jp-Collapser,
    .jp-Notebook .jp-Cell .jp-Cell-inputCollapser,
    .jp-Notebook .jp-Cell .jp-Cell-outputCollapser {
      display: none !important;
      width: 0 !important;
      background: transparent !important;
    }

    /* 4. Zell-Toolbar aktivieren – modern, schwebend & mit Abstand zum Text */
    .jp-Notebook .jp-Cell .jp-Cell-toolbar,
    .jp-Notebook .jp-Cell .jp-cell-toolbar,
    .jp-Notebook .jp-CellHeader {
      display: flex !important;
      visibility: visible !important;
      opacity: 1 !important;
      height: auto !important;
      align-items: center !important;
      gap: 4px !important;
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 8px !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05) !important;
      padding: 3px 8px !important;
      margin-top: 4px !important;
      margin-bottom: 12px !important; /* Ausreichend Abstand zum Zellinhalt */
      width: fit-content !important;
      margin-left: auto !important;   /* Rechtsbündig platziert */
      z-index: 10 !important;
      flex-shrink: 0 !important;
    }

    /* Toolbar-Buttons sauber und ohne blaue Hintergründe */
    .jp-Notebook .jp-Cell .jp-Cell-toolbar button,
    .jp-Notebook .jp-Cell .jp-cell-toolbar button,
    .jp-Notebook .jp-Cell .jp-ToolbarButtonComponent {
      background: transparent !important;
      border: none !important;
      border-radius: 6px !important;
      color: #475569 !important;
      padding: 3px 6px !important;
      transition: background 0.15s ease, color 0.15s ease !important;
    }

    .jp-Notebook .jp-Cell .jp-Cell-toolbar button:hover,
    .jp-Notebook .jp-Cell .jp-cell-toolbar button:hover,
    .jp-Notebook .jp-Cell .jp-ToolbarButtonComponent:hover {
      background: #f1f5f9 !important;
      color: #0f172a !important;
    }

    /* Play & Stop Buttons in Code-Zell Toolbar */
    .jp-Notebook .jp-Cell .jp-Cell-toolbar .obsidian-code-play-btn {
      color: #059669 !important;
      background: #ecfdf5 !important;
      border: 1px solid #a7f3d0 !important;
      font-weight: 600 !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      padding: 2px 7px !important;
      border-radius: 6px !important;
      font-size: 11px !important;
      cursor: pointer !important;
      transition: background 0.15s ease, color 0.15s ease !important;
    }
    .jp-Notebook .jp-Cell .jp-Cell-toolbar .obsidian-code-play-btn:hover {
      background: #d1fae5 !important;
      color: #047857 !important;
      border-color: #6ee7b7 !important;
    }
    .jp-Notebook .jp-Cell .jp-Cell-toolbar .obsidian-code-stop-btn {
      color: #e11d48 !important;
      background: #fff1f2 !important;
      border: 1px solid #fecdd3 !important;
      font-weight: 600 !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      padding: 2px 7px !important;
      border-radius: 6px !important;
      font-size: 11px !important;
      cursor: pointer !important;
      transition: background 0.15s ease, color 0.15s ease !important;
    }
    .jp-Notebook .jp-Cell .jp-Cell-toolbar .obsidian-code-stop-btn:hover {
      background: #ffe4e6 !important;
      color: #be123c !important;
      border-color: #fda4af !important;
    }

    /* 5. Editor-Fokusrahmen (blaue Umrandung im Editiermodus) deaktivieren */
    .jp-Notebook.jp-mod-editMode .jp-Cell.jp-mod-active .jp-InputArea-editor,
    .jp-Notebook .jp-Cell .jp-InputArea-editor,
    .jp-Notebook .jp-Cell .cm-editor.cm-focused,
    .jp-Notebook .jp-Cell .cm-focused {
      outline: none !important;
      border-color: transparent !important;
      box-shadow: none !important;
    }

    /* JupyterLab InputPrompt anpassen (transparent statt grau) */
    .jp-Notebook .jp-Cell .jp-InputPrompt {
      background: transparent !important;
      color: #94a3b8 !important;
      font-size: 11px !important;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      font-weight: 500 !important;
      padding-top: 10px !important;
    }

    /* Toolbar im NeME Dark Theme - fest verankert DARUNTER */
    .obsidian-markdown-cell .jp-Cell-inputWrapper {
      display: flex !important;
      flex-direction: column !important;
      width: 100% !important;
    }
    .obsidian-floating-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 3px;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 6px 10px;
      margin-top: 8px;
      margin-bottom: 4px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      z-index: 20;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #e4e4e7;
      width: 100%;
      box-sizing: border-box;
      clear: both;
    }
    .obsidian-tb-brand {
      font-size: 11px;
      font-weight: 700;
      color: #c084fc;
      padding: 3px 7px;
      background: rgba(192, 132, 252, 0.12);
      border: 1px solid rgba(192, 132, 252, 0.25);
      border-radius: 5px;
      display: flex;
      align-items: center;
      gap: 4px;
      margin-right: 4px;
    }
    .obsidian-tb-divider {
      width: 1px;
      height: 18px;
      background: #3f3f46;
      margin: 0 3px;
    }
    .obsidian-tb-btn {
      background: transparent;
      border: 1px solid transparent;
      border-radius: 5px;
      padding: 4px 7px;
      font-size: 12px;
      color: #d4d4d8;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
    }
    .obsidian-tb-btn:hover {
      background: #27272a;
      color: #ffffff;
      border-color: #3f3f46;
    }
    .obsidian-tb-btn:disabled,
    .obsidian-tb-btn[disabled] {
      opacity: 0.35 !important;
      cursor: not-allowed !important;
      pointer-events: none !important;
    }
    .obsidian-tb-btn svg {
      stroke: currentColor;
    }
    .obsidian-tb-btn-primary {
      background: #7c3aed;
      color: white;
      border-color: #6d28d9;
    }
    .obsidian-tb-btn-primary:hover {
      background: #6d28d9;
    }

    /* Modus-Umschaltung (Live Preview, Split, Source, Gelesen) */
    .obsidian-tb-mode-group {
      display: inline-flex;
      align-items: center;
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 6px;
      padding: 2px;
      gap: 2px;
      margin-left: auto;
    }
    .obsidian-tb-mode-btn {
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 500;
      color: #a1a1aa;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
    }
    .obsidian-tb-mode-btn:hover {
      color: #f4f4f5;
      background: #18181b;
    }
    .obsidian-tb-mode-btn.active {
      background: #27272a;
      color: #fbbf24;
      border-color: #3f3f46;
      font-weight: 600;
    }
    .obsidian-tb-mode-btn svg {
      stroke: currentColor;
    }

    /* Split-View Container (2 Spalten nebeneinander: Links Live-Vorschau, Rechts Editor auf gleicher Zeilenhöhe) */
    .obsidian-cell-split {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
      grid-template-rows: auto !important;
      gap: 14px !important;
      align-items: stretch !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    /* Prompt in Split-Ansicht ausblenden, damit genau 2 Spalten nebeneinander stehen */
    .obsidian-cell-split > .jp-InputPrompt,
    .obsidian-cell-split > .jp-InputArea-prompt,
    .obsidian-cell-split > .jp-Cell-prompt {
      display: none !important;
    }
    /* Linke Spalte (Spalte 1, Zeile 1): Live-Vorschau links auf gleicher Zeilenhöhe */
    .obsidian-cell-split > .obsidian-split-preview {
      grid-column: 1 / 2 !important;
      grid-row: 1 !important;
      width: 100% !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
      background: var(--jp-cell-editor-background, var(--jp-layout-color1, #18181b));
      border: 1px solid var(--jp-border-color2, rgba(128, 128, 128, 0.2));
      border-radius: 8px;
      padding: 14px 18px;
      overflow-y: auto;
      max-height: 520px;
      min-height: 180px;
      color: var(--jp-content-font-color1, inherit);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.6;
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
    }
    /* Rechte Spalte (Spalte 2, Zeile 1): Editor rechts */
    .obsidian-cell-split > .jp-InputArea-editor,
    .obsidian-cell-split > .jp-Editor,
    .obsidian-cell-split > .jp-CodeMirrorEditor {
      grid-column: 2 / 3 !important;
      grid-row: 1 !important;
      width: 100% !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
    }

    /* Live Preview Modus: Editor oben, Live-Vorschau direkt UNTEREINANDER darunter */
    .obsidian-cell-live {
      display: flex !important;
      flex-direction: column !important;
      align-items: stretch !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    /* Prompt in Live Preview ausblenden, damit Editor und Vorschau volle 100% Breite nutzen */
    .obsidian-cell-live > .jp-InputPrompt,
    .obsidian-cell-live > .jp-InputArea-prompt,
    .obsidian-cell-live > .jp-Cell-prompt {
      display: none !important;
    }
    .obsidian-cell-live > .jp-InputArea-editor,
    .obsidian-cell-live > .jp-Editor,
    .obsidian-cell-live > .jp-CodeMirrorEditor {
      width: 100% !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
    }
    .obsidian-live-preview {
      display: block !important;
      width: 100% !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
      background: var(--jp-cell-editor-background, var(--jp-layout-color1, #18181b));
      border: 1px solid var(--jp-border-color2, rgba(128, 128, 128, 0.2));
      border-radius: 8px;
      padding: 14px 18px;
      margin-top: 10px;
      color: var(--jp-content-font-color1, inherit);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.6;
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
    }
    .obsidian-preview-header {
      font-size: 11px;
      font-weight: 600;
      color: var(--jp-ui-font-color2, #a1a1aa);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--jp-border-color2, rgba(128, 128, 128, 0.15));
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .obsidian-preview-badge {
      font-size: 10px;
      color: #34d399;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .obsidian-preview-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #34d399;
      display: inline-block;
    }
    .obsidian-preview-body {
      color: var(--jp-content-font-color1, inherit);
    }
    .obsidian-preview-body .MathJax,
    .obsidian-preview-body mjx-container,
    .obsidian-preview-body .katex,
    .obsidian-preview-body .katex-display,
    .obsidian-preview-body .katex-html {
      color: var(--jp-content-font-color1, inherit) !important;
    }

    /* Interaktive Checkboxen & Aufgabenlisten */
    .jp-RenderedMarkdown input[type="checkbox"],
    .obsidian-preview-body input[type="checkbox"] {
      cursor: pointer !important;
      accent-color: #f59e0b !important;
      pointer-events: auto !important;
    }
    .obsidian-task-done {
      text-decoration: line-through !important;
      opacity: 0.65 !important;
    }

    /* Dropdowns */
    .obsidian-dropdown-container {
      position: relative;
      display: inline-block;
    }
    .obsidian-dropdown-menu {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 4px;
      background: #18181b;
      border: 1px solid #3f3f46;
      border-radius: 8px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      min-width: 160px;
      z-index: 100;
      padding: 4px;
    }
    .obsidian-dropdown-menu.show {
      display: block;
    }
    .obsidian-dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 10px;
      font-size: 12px;
      color: #e4e4e7;
      background: transparent;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      text-align: left;
    }
    .obsidian-dropdown-item:hover {
      background: #27272a;
      color: #38bdf8;
    }

    /* Modal-Overlays */
    .obsidian-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .obsidian-modal {
      background: #18181b;
      color: #f4f4f5;
      border: 1px solid #3f3f46;
      border-radius: 12px;
      width: 92%;
      max-width: 680px;
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      overflow: hidden;
    }
    .obsidian-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 18px;
      background: #27272a;
      border-bottom: 1px solid #3f3f46;
    }
    .obsidian-modal-header h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: #fafafa;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .obsidian-modal-close {
      background: transparent;
      border: none;
      color: #a1a1aa;
      font-size: 22px;
      cursor: pointer;
      line-height: 1;
    }
    .obsidian-modal-close:hover {
      color: #ffffff;
    }
    .obsidian-modal-body {
      padding: 18px;
      overflow-y: auto;
      flex: 1;
    }
    .obsidian-modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 14px 18px;
      background: #27272a;
      border-top: 1px solid #3f3f46;
    }

    /* Vorschau-Tabellen in Live Preview & Split View */
    .obsidian-table-wrapper {
      width: 100%;
      overflow-x: auto;
      margin: 12px 0;
      border-radius: 8px;
      border: 1px solid var(--jp-border-color2, rgba(128, 128, 128, 0.25));
      background: transparent;
    }
    .obsidian-preview-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--jp-content-font-color1, inherit);
      background: transparent;
      font-family: var(--jp-ui-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    }
    .obsidian-preview-table thead tr {
      background: transparent;
      border-bottom: 2px solid var(--jp-border-color2, rgba(128, 128, 128, 0.3));
    }
    .obsidian-preview-table th {
      padding: 9px 14px;
      font-weight: 600;
      color: var(--jp-content-font-color0, inherit);
      border-right: 1px solid var(--jp-border-color2, rgba(128, 128, 128, 0.15));
      white-space: nowrap;
      background: transparent;
    }
    .obsidian-preview-table th:last-child {
      border-right: none;
    }
    .obsidian-preview-table td {
      padding: 8px 14px;
      border-top: 1px solid var(--jp-border-color2, rgba(128, 128, 128, 0.15));
      border-right: 1px solid var(--jp-border-color2, rgba(128, 128, 128, 0.15));
      color: var(--jp-content-font-color1, inherit);
      background: transparent;
    }
    .obsidian-preview-table td:last-child {
      border-right: none;
    }
    .obsidian-preview-table tbody tr {
      background: transparent;
    }
    .obsidian-preview-table tbody tr:nth-child(even) {
      background: transparent;
    }
    .obsidian-preview-table tbody tr:hover {
      background: rgba(128, 128, 128, 0.05);
    }

    /* Tabellen-Editor Grid */
    .obsidian-table-grid {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
    }
    .obsidian-table-grid th, .obsidian-table-grid td {
      border: 1px solid #3f3f46;
      padding: 4px;
      background: transparent;
    }
    .obsidian-table-grid input {
      width: 100%;
      box-sizing: border-box;
      background: #18181b;
      border: 1px solid #3f3f46;
      color: #f4f4f5;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 13px;
    }
    .obsidian-table-grid input:focus {
      outline: none;
      border-color: #a855f7;
    }
    .obsidian-col-ctrl {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 4px;
    }
    .obsidian-col-ctrl button {
      background: #3f3f46;
      border: none;
      color: #d4d4d8;
      border-radius: 3px;
      padding: 2px 6px;
      font-size: 10px;
      cursor: pointer;
    }
    .obsidian-col-ctrl button:hover {
      background: #52525b;
      color: white;
    }

    /* Math Chips & Preview */
    .obsidian-chips-group {
      margin-bottom: 12px;
    }
    .obsidian-chips-title {
      font-size: 11px;
      font-weight: 600;
      color: #a1a1aa;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .obsidian-chips-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }
    .obsidian-chip {
      background: #27272a;
      border: 1px solid #3f3f46;
      color: #e4e4e7;
      padding: 4px 8px;
      border-radius: 5px;
      font-size: 12px;
      cursor: pointer;
      font-family: monospace;
      transition: all 0.15s ease;
    }
    .obsidian-chip:hover {
      background: #3f3f46;
      border-color: #a855f7;
      color: #ffffff;
    }
    .obsidian-math-preview {
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 14px;
      margin: 10px 0;
      min-height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow-x: auto;
    }

    /* Buttons */
    .obsidian-btn {
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .obsidian-btn-sec {
      background: #27272a;
      border: 1px solid #3f3f46;
      color: #e4e4e7;
    }
    .obsidian-btn-sec:hover {
      background: #3f3f46;
    }
    .obsidian-btn-pri {
      background: #7c3aed;
      border: 1px solid #6d28d9;
      color: #ffffff;
    }
    .obsidian-btn-pri:hover {
      background: #6d28d9;
    }

    /* Rendered Cell Enhancements */
    .obsidian-table-wrapper {
      position: relative;
      margin: 12px 0;
      overflow-x: auto;
    }
    .obsidian-table-wrapper:hover .obsidian-table-edit-btn {
      opacity: 1;
    }
    .obsidian-table-edit-btn {
      position: absolute;
      top: 6px;
      right: 6px;
      background: #27272a;
      color: #38bdf8;
      border: 1px solid #3f3f46;
      border-radius: 5px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s ease, background 0.15s ease;
      z-index: 10;
      box-shadow: 0 4px 10px rgba(0,0,0,0.3);
    }
    .obsidian-table-edit-btn:hover {
      background: #3f3f46;
      color: #ffffff;
    }

    /* Block-Formeln Hover-Container & Edit-Button - Passt sich dem Theme an! */
    .obsidian-math-block-wrapper {
      position: relative;
      margin: 12px 0;
      padding: 14px 16px;
      background: rgba(128, 128, 128, 0.05);
      color: var(--jp-content-font-color1, inherit);
      border: 1px solid var(--jp-border-color2, rgba(128, 128, 128, 0.18));
      border-radius: 8px;
      overflow-x: auto;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .obsidian-math-block-wrapper:hover {
      border-color: #f59e0b;
      box-shadow: 0 0 14px rgba(245, 158, 11, 0.15);
    }
    .obsidian-math-block-wrapper:hover .obsidian-math-edit-btn {
      opacity: 1;
      border-color: #f59e0b;
      color: #f59e0b;
    }
    .obsidian-math-block-wrapper .MathJax,
    .obsidian-math-block-wrapper mjx-container,
    .obsidian-math-block-wrapper .katex,
    .obsidian-math-block-wrapper .katex-display,
    .obsidian-math-block-wrapper .katex-html,
    .obsidian-math-block-wrapper .jp-RenderedMath {
      color: var(--jp-content-font-color1, inherit) !important;
    }

    .obsidian-math-edit-btn {
      position: absolute;
      top: 6px;
      right: 6px;
      background: var(--jp-layout-color1, #27272a);
      color: var(--jp-ui-font-color1, #d4d4d8);
      border: 1px solid var(--jp-border-color1, #3f3f46);
      border-radius: 6px;
      padding: 4px 9px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      opacity: 0;
      transition: all 0.15s ease;
      z-index: 10;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .obsidian-math-edit-btn:hover {
      background: rgba(128, 128, 128, 0.2);
      color: #f59e0b;
      border-color: #f59e0b;
    }
    .obsidian-math-edit-btn svg {
      stroke: currentColor;
    }

    /* Inline-Formeln Hover-Effekt & Edit-Badge */
    .obsidian-inline-math-wrapper {
      position: relative;
      display: inline-flex;
      align-items: center;
      padding: 1px 4px;
      margin: 0 2px;
      border-radius: 4px;
      cursor: pointer;
      color: var(--jp-content-font-color1, inherit);
      transition: background 0.15s ease, box-shadow 0.15s ease;
    }
    .obsidian-inline-math-wrapper:hover {
      background: rgba(245, 158, 11, 0.12) !important;
      box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.35);
    }
    .obsidian-inline-math-wrapper .MathJax,
    .obsidian-inline-math-wrapper mjx-container,
    .obsidian-inline-math-wrapper .katex,
    .obsidian-inline-math-wrapper .jp-RenderedMath {
      color: var(--jp-content-font-color1, inherit) !important;
    }
    .obsidian-inline-math-wrapper .obsidian-inline-edit-btn {
      display: inline-flex;
      align-items: center;
      margin-left: 4px;
      color: #fbbf24;
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .obsidian-inline-math-wrapper:hover .obsidian-inline-edit-btn {
      opacity: 1;
    }

    /* Callouts */
    .obsidian-callout {
      border-left: 4px solid #38bdf8 !important;
      background: rgba(56, 189, 248, 0.08) !important;
      border-radius: 0 8px 8px 0;
      padding: 12px 16px !important;
      margin: 12px 0 !important;
    }
    .obsidian-callout-tip {
      border-left-color: #34d399 !important;
      background: rgba(52, 211, 153, 0.08) !important;
    }
    .obsidian-callout-warning {
      border-left-color: #fbbf24 !important;
      background: rgba(251, 191, 36, 0.08) !important;
    }
    .obsidian-callout-caution, .obsidian-callout-danger {
      border-left-color: #f87171 !important;
      background: rgba(248, 113, 113, 0.08) !important;
    }
    .obsidian-callout-important {
      border-left-color: #c084fc !important;
      background: rgba(192, 132, 252, 0.08) !important;
    }
    .obsidian-callout-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.1);
      margin-right: 6px;
    }

    /* NeME Variable Inspector Panel */
    .obsidian-variable-panel {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 480px;
      max-width: 90vw;
      max-height: 520px;
      background: #18181b;
      border: 1px solid #3f3f46;
      border-radius: 12px;
      box-shadow: 0 20px 35px rgba(0, 0, 0, 0.65);
      z-index: 99998;
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      color: #f4f4f5;
    }
    .obsidian-var-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #09090b;
      border-bottom: 1px solid #27272a;
    }
    .obsidian-var-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      color: #f4f4f5;
    }
    .obsidian-var-badge {
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: #38bdf8;
      font-size: 11px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 10px;
    }
    .obsidian-var-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .obsidian-var-icon-btn {
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 4px;
      color: #a1a1aa;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }
    .obsidian-var-icon-btn:hover {
      background: #27272a;
      color: #f4f4f5;
      border-color: #3f3f46;
    }
    .obsidian-var-search-bar {
      padding: 8px 12px;
      background: #18181b;
      border-bottom: 1px solid #27272a;
    }
    .obsidian-var-search-bar input {
      width: 100%;
      box-sizing: border-box;
      background: #09090b;
      border: 1px solid #3f3f46;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      color: #f4f4f5;
      outline: none;
    }
    .obsidian-var-search-bar input:focus {
      border-color: #38bdf8;
    }
    .obsidian-var-body {
      flex: 1;
      overflow-y: auto;
      max-height: 340px;
      background: #121215;
    }
    .obsidian-var-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      text-align: left;
    }
    .obsidian-var-table th {
      position: sticky;
      top: 0;
      background: #18181b;
      padding: 7px 10px;
      font-size: 11px;
      font-weight: 600;
      color: #a1a1aa;
      text-transform: uppercase;
      border-bottom: 1px solid #27272a;
      z-index: 2;
    }
    .obsidian-var-table td {
      padding: 7px 10px;
      border-bottom: 1px solid #1f1f23;
      vertical-align: middle;
    }
    .obsidian-var-row:hover td {
      background: rgba(255, 255, 255, 0.03);
    }
    .obsidian-var-name code {
      color: #38bdf8;
      font-family: monospace;
      font-weight: 600;
      font-size: 12px;
    }
    .obsidian-type-pill {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      font-family: monospace;
    }
    .obsidian-type-df {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
    }
    .obsidian-type-array {
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: #fbbf24;
    }
    .obsidian-type-num {
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: #818cf8;
    }
    .obsidian-type-str {
      background: rgba(236, 72, 153, 0.15);
      border: 1px solid rgba(236, 72, 153, 0.3);
      color: #f472b6;
    }
    .obsidian-type-collection {
      background: rgba(168, 85, 247, 0.15);
      border: 1px solid rgba(168, 85, 247, 0.3);
      color: #c084fc;
    }
    .obsidian-type-generic {
      background: #27272a;
      border: 1px solid #3f3f46;
      color: #d4d4d8;
    }
    .obsidian-var-shape {
      color: #a1a1aa;
      font-family: monospace;
      font-size: 11px;
    }
    .obsidian-var-val {
      color: #d4d4d8;
      font-family: monospace;
      font-size: 11px;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .obsidian-var-empty {
      padding: 30px 20px;
      text-align: center;
      color: #71717a;
      font-size: 12px;
      line-height: 1.6;
    }
    .obsidian-var-loading {
      padding: 24px;
      text-align: center;
      color: #a1a1aa;
      font-size: 12px;
    }
    .obsidian-var-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: #09090b;
      border-top: 1px solid #27272a;
      font-size: 11px;
      color: #71717a;
    }
    .obsidian-var-auto-label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      color: #a1a1aa;
    }
    .obsidian-toolbar-var-btn {
      background: rgba(56, 189, 248, 0.12) !important;
      border: 1px solid rgba(56, 189, 248, 0.3) !important;
      color: #38bdf8 !important;
      border-radius: 6px !important;
      padding: 2px 8px !important;
      margin-left: 6px !important;
      cursor: pointer !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      transition: all 0.15s ease !important;
    }
    .obsidian-toolbar-var-btn:hover {
      background: rgba(56, 189, 248, 0.22) !important;
      border-color: #38bdf8 !important;
    }

    /* Toast */
    .obsidian-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #18181b;
      color: #ffffff;
      border: 1px solid #3f3f46;
      padding: 10px 18px;
      border-radius: 8px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      z-index: 999999;
      font-size: 13px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: opacity 0.3s ease;
    }
    .obsidian-toast-fade {
      opacity: 0;
    }
  `;
  document.head.appendChild(styleEl);
}

/**
 * Lädt KaTeX für die Live-Vorschau dynamisch ohne npm-Chunk-Konflikte
 */
function loadKaTeXScript(): void {
  if (document.getElementById('obsidian-katex-script')) return;
  const link = document.createElement('link');
  link.id = 'obsidian-katex-css';
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
  document.head.appendChild(link);

  const script = document.createElement('script');
  script.id = 'obsidian-katex-script';
  script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
  script.async = true;
  document.head.appendChild(script);
}

function renderKaTeXPreview(tex: string, isBlock: boolean): string {
  const k = (window as any).katex;
  if (k && typeof k.renderToString === 'function') {
    try {
      return k.renderToString(tex.trim(), { displayMode: isBlock, throwOnError: false });
    } catch (e: any) {
      return `<span style="color: #f87171; font-size: 12px;">LaTeX Fehler: ${tex}</span>`;
    }
  }
  return `<span style="font-family: monospace; color: #fbbf24; font-size: 13px;">${tex}</span>`;
}

function showNemeToast(message: string): void {
  const existing = document.getElementById('obsidian-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'obsidian-toast';
  toast.className = 'obsidian-toast';
  toast.innerHTML = `<span>${message}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('obsidian-toast-fade');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

function splitNemeTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let text = trimmed;
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);

  const cells: string[] = [];
  let currentCell = '';
  let inBackticks = false;
  let inMath = false;
  let isEscaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (isEscaped) {
      currentCell += ch;
      isEscaped = false;
      continue;
    }
    if (ch === '\\') {
      currentCell += ch;
      isEscaped = true;
      continue;
    }
    if (ch === '`' && !inMath) {
      inBackticks = !inBackticks;
      currentCell += ch;
      continue;
    }
    if (ch === '$' && !inBackticks) {
      inMath = !inMath;
      currentCell += ch;
      continue;
    }
    if (ch === '|' && !inBackticks && !inMath) {
      cells.push(currentCell.trim());
      currentCell = '';
      continue;
    }
    currentCell += ch;
  }
  cells.push(currentCell.trim());
  return cells;
}

function isNemeTableDelimiter(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes('-')) return false;
  let inner = trimmed;
  if (inner.startsWith('|')) inner = inner.slice(1);
  if (inner.endsWith('|') && !inner.endsWith('\\|')) inner = inner.slice(0, -1);
  const rawCells = inner.split('|');
  if (rawCells.length === 0) return false;
  for (const raw of rawCells) {
    const cell = raw.trim();
    if (!cell) return false;
    if (!/^:?-+:?$/.test(cell)) return false;
  }
  return true;
}

function formatNemeTableCell(cellText: string): string {
  let res = cellText;
  res = res.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => renderKaTeXPreview(tex, true));
  const inlineRegex = /(?<![\$\\])\$(?!\$)([^\$\n]+?)(?<![\$\\])\$(?!\$)/g;
  res = res.replace(inlineRegex, (_, tex) => renderKaTeXPreview(tex, false));
  res = res.replace(/==(.*?)==/g, '<mark style="background: rgba(251, 191, 36, 0.2); color: #fbbf24; padding: 0 4px; border-radius: 3px;">$1</mark>');
  res = res.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  res = res.replace(/\*(.*?)\*/g, '<em>$1</em>');
  res = res.replace(/~~(.*?)~~/g, '<del style="color: var(--jp-content-font-color2, #a1a1aa);">$1</del>');
  res = res.replace(/`([^`]+)`/g, '<code style="background: rgba(128, 128, 128, 0.14); padding: 2px 5px; border-radius: 4px; font-family: monospace; font-size: 12px; color: var(--jp-content-font-color1, #38bdf8); border: 1px solid rgba(128, 128, 128, 0.18);">$1</code>');
  res = res.replace(/\\\|/g, '|');
  return res;
}

function escapeNemeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Toggelt eine Checkbox [ ] <-> [x] im Markdown-Quelltext basierend auf dem Checkbox-Index
 */
function toggleNemeMarkdownCheckbox(markdown: string, targetIndex: number, newChecked?: boolean): string {
  const lines = markdown.split('\n');
  let currentCheckboxIndex = 0;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    // Match task list item: - [ ] oder - [x] oder * [ ] oder + [ ] oder 1. [ ]
    const match = line.match(/^(\s*(?:[-*+]|\d+\.)\s*\[)([ xX])(\]\s*.*)$/);
    if (match) {
      if (currentCheckboxIndex === targetIndex) {
        const isCurrentlyChecked = match[2].toLowerCase() === 'x';
        const willBeChecked = newChecked !== undefined ? newChecked : !isCurrentlyChecked;
        lines[i] = match[1] + (willBeChecked ? 'x' : ' ') + match[3];
        break;
      }
      currentCheckboxIndex++;
    }
  }

  return lines.join('\n');
}

/**
 * Live Markdown & KaTeX Renderer für die Split- und Live-Preview
 */
function renderNemeMarkdown(src: string): string {
  if (!src || src.trim().length === 0) {
    return '<div style="color: #71717a; font-style: italic; font-size: 12px; padding: 6px 0;">Kein Inhalt...</div>';
  }

  // Normalize line endings
  const normalizedSrc = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedSrc.split('\n');
  const tablePlaceholders: { [key: string]: string } = {};
  let tableCounter = 0;
  const codePlaceholders: { [key: string]: string } = {};
  let codeCounter = 0;
  const processedLines: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // 0. Code-Bloecke (Fenced Blocks mit Triple-Backticks oder Tildes) vorab extrahieren
    if (trimmedLine.startsWith('```') || trimmedLine.startsWith('~~~')) {
      const fence = trimmedLine.slice(0, 3);
      const lang = trimmedLine.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        i++; // schliessenden Fence ueberspringen
      }

      const escapedCode = codeLines.map(cl => escapeNemeHtml(cl)).join('\n');
      const placeholder = '<!--NeME_CODE_BLOCK_' + (codeCounter++) + '-->';
      const displayLang = escapeNemeHtml(lang || 'code');
      const codeHtml = '<div class="obsidian-code-block" style="margin: 8px 0; border-radius: 6px; overflow: hidden; border: 1px solid rgba(128, 128, 128, 0.25); background: #09090b; font-family: monospace;">' +
        '<div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 10px; background: rgba(255, 255, 255, 0.05); border-bottom: 1px solid rgba(128, 128, 128, 0.15); font-size: 11px; color: var(--jp-content-font-color2, #a1a1aa); text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">' +
        '<span>' + displayLang + '</span>' +
        '</div>' +
        '<pre style="margin: 0; padding: 10px 12px; font-family: monospace; font-size: 12px; line-height: 1.5; color: #f4f4f5; overflow-x: auto; white-space: pre;"><code>' + escapedCode + '</code></pre>' +
        '</div>';

      codePlaceholders[placeholder] = codeHtml;
      processedLines.push(placeholder);
      continue;
    }

    const isTable = i + 1 < lines.length && isNemeTableDelimiter(lines[i + 1]) && (line.includes('|') || line.trim().startsWith('|'));

    if (isTable) {
      const tableLines: string[] = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].trim().length > 0 && (lines[i].includes('|') || lines[i].trim().startsWith('|'))) {
        tableLines.push(lines[i]);
        i++;
      }

      const headers = splitNemeTableRow(tableLines[0]);
      if (headers.length > 0) {
        const alignCells = splitNemeTableRow(tableLines[1]);
        const alignments = alignCells.map(c => {
          if (c.startsWith(':') && c.endsWith(':')) return 'center';
          if (c.endsWith(':')) return 'right';
          return 'left';
        });
        const colCount = headers.length;

        let tableHtml = '<div class="obsidian-table-wrapper" style="background: transparent;"><table class="obsidian-preview-table" style="background: transparent;"><thead><tr style="background: transparent;">';
        headers.forEach((h, hIdx) => {
          const align = alignments[hIdx] || 'left';
          tableHtml += `<th style="text-align: ${align}; background: transparent;">${formatNemeTableCell(h)}</th>`;
        });
        tableHtml += '</tr></thead><tbody>';

        for (let r = 2; r < tableLines.length; r++) {
          const rowCells = splitNemeTableRow(tableLines[r]);
          tableHtml += '<tr style="background: transparent;">';
          for (let c = 0; c < colCount; c++) {
            const cellVal = rowCells[c] !== undefined ? rowCells[c] : '';
            const align = alignments[c] || 'left';
            tableHtml += `<td style="text-align: ${align}; background: transparent;">${formatNemeTableCell(cellVal)}</td>`;
          }
          tableHtml += '</tr>';
        }
        tableHtml += '</tbody></table></div>';

        const placeholder = `<!--NeME_TABLE_${tableCounter++}-->`;
        tablePlaceholders[placeholder] = tableHtml;
        processedLines.push(placeholder);
        continue;
      }
    }

    processedLines.push(line);
    i++;
  }

  let html = processedLines.join('\n');

  // 1. Block-Gleichungen ($$...$$)
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => {
    return `<div class="obsidian-math-block-wrapper">${renderKaTeXPreview(tex, true)}</div>`;
  });

  // 2. Inline-Gleichungen ($...$)
  const inlineRegex = /(?<![\$\\])\$(?!\$)([^\$\n]+?)(?<![\$\\])\$(?!\$)/g;
  html = html.replace(inlineRegex, (_, tex) => {
    return `<span class="obsidian-inline-math-wrapper">${renderKaTeXPreview(tex, false)}</span>`;
  });

  // 3. NeME Callouts (> [!NOTE])
  html = html.replace(/(?:^|\n)> ?\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT|INFO|DANGER|INSIGHT|EQUATION)\] ?(.*(?:\n> ?.*)*)/gi, (_, type, content) => {
    const cleanType = type.toUpperCase();
    const cleanContent = content.replace(/\n> ?/g, '<br>');
    return `<div class="obsidian-callout obsidian-callout-${type.toLowerCase()}"><div class="obsidian-callout-header"><span class="obsidian-callout-badge">${cleanType}</span></div><div style="font-size: 12px; margin-top: 4px;">${cleanContent}</div></div>`;
  });

  // 4. Überschriften
  html = html.replace(/^### (.*$)/gim, '<h3 style="font-size: 15px; font-weight: 700; color: var(--jp-content-font-color0, #f4f4f5); margin: 10px 0 6px;">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="font-size: 17px; font-weight: 700; color: var(--jp-content-font-color0, #f4f4f5); margin: 12px 0 6px;">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 style="font-size: 20px; font-weight: 800; color: var(--jp-content-font-color0, #fafafa); margin: 14px 0 8px;">$1</h1>');

  // 5. Textformatierungen
  html = html.replace(/==(.*?)==/g, '<mark style="background: rgba(251, 191, 36, 0.2); color: #fbbf24; padding: 0 4px; border-radius: 3px;">$1</mark>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/~~(.*?)~~/g, '<del style="color: var(--jp-content-font-color2, #a1a1aa);">$1</del>');
  const inlineCodeRegex = new RegExp('\x60([^\x60\n]+)\x60', 'g');
  html = html.replace(inlineCodeRegex, (_, code) => {
    return '<code style="background: rgba(128, 128, 128, 0.18); padding: 2px 5px; border-radius: 4px; font-family: monospace; font-size: 12px; color: var(--jp-content-font-color1, #38bdf8); border: 1px solid rgba(128, 128, 128, 0.2);">' + escapeNemeHtml(code) + '</code>';
  });

  // 6. Checklisten & Listen
  let taskCounter = 0;
  html = html.replace(/^(\s*(?:[-*+]|\d+\.)\s*)\[([ xX])\]\s*(.*$)/gim, (_, prefix, checkChar, text) => {
    const isChecked = checkChar.toLowerCase() === 'x';
    const taskIdx = taskCounter++;
    const indent = Math.min(Math.floor(prefix.length / 2) * 12, 48);
    const textStyle = isChecked
      ? 'text-decoration: line-through; color: var(--jp-content-font-color2, #a1a1aa);'
      : 'color: var(--jp-content-font-color1, inherit);';
    return '<div class="obsidian-task-item" style="display: flex; align-items: flex-start; gap: 8px; margin: 3px 0; margin-left: ' + indent + 'px;">' +
      '<input type="checkbox" class="obsidian-task-checkbox" data-task-index="' + taskIdx + '" ' + (isChecked ? 'checked' : '') + ' style="margin-top: 3px; cursor: pointer; accent-color: #f59e0b; width: 14px; height: 14px; flex-shrink: 0;">' +
      '<span class="obsidian-task-text" style="' + textStyle + '">' + text + '</span>' +
      '</div>';
  });
  html = html.replace(/^(\s*[-*+]\s+)(.*$)/gim, '<li style="margin-left: 18px;">$2</li>');

  // Absätze / Newlines
  html = html.replace(/\n\n/g, '<br><br>');

  // Tabellen-Platzhalter wiederherstellen
  for (const placeholder in tablePlaceholders) {
    html = html.replace(placeholder, tablePlaceholders[placeholder]);
  }

  // Code-Block-Platzhalter wiederherstellen
  for (const placeholder in codePlaceholders) {
    html = html.replace(placeholder, codePlaceholders[placeholder]);
  }

  return html;
}

function updateActivePreview(cell: MarkdownCell): void {
  const mode = (cell as any)._obsidianMode;
  const src = cell.model.sharedModel.getSource();

  const bindCheckboxes = (previewBody: HTMLElement) => {
    previewBody.querySelectorAll<HTMLInputElement>('.obsidian-task-checkbox').forEach(cb => {
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const taskIdx = parseInt(cb.getAttribute('data-task-index') || '0', 10);
        const currentSrc = cell.model.sharedModel.getSource();
        const updated = toggleNemeMarkdownCheckbox(currentSrc, taskIdx, cb.checked);
        if (updated !== currentSrc) {
          cell.model.sharedModel.setSource(updated);
        }
      });
    });
  };

  if (mode === 'split') {
    const preview = cell.node.querySelector('.obsidian-split-preview .obsidian-preview-body') as HTMLElement | null;
    if (preview) {
      preview.innerHTML = renderNemeMarkdown(src);
      bindCheckboxes(preview);
    }
  } else if (mode === 'live') {
    const preview = cell.node.querySelector('.obsidian-live-preview .obsidian-preview-body') as HTMLElement | null;
    if (preview) {
      preview.innerHTML = renderNemeMarkdown(src);
      bindCheckboxes(preview);
    }
  }
}

function updateToolbarDisabledState(toolbar: HTMLElement, isRendered: boolean): void {
  toolbar.querySelectorAll<HTMLButtonElement>('[data-action], .obsidian-dropdown-toggle').forEach(btn => {
    btn.disabled = isRendered;
    if (isRendered) {
      if (!btn.hasAttribute('data-original-title')) {
        btn.setAttribute('data-original-title', btn.getAttribute('title') || '');
      }
      btn.setAttribute('title', 'Formatierung im Lesemodus deaktiviert');
    } else {
      const orig = btn.getAttribute('data-original-title');
      if (orig) btn.setAttribute('title', orig);
    }
  });
}

function setCellEditorMode(cell: MarkdownCell, mode: 'live' | 'split' | 'source' | 'rendered'): void {
  (cell as any)._obsidianMode = mode;
  if (mode !== 'rendered') {
    (cell as any)._lastEditMode = mode;
  }

  // Toolbar Button-Zustände synchronisieren
  const toolbar = (cell.node.querySelector('.obsidian-floating-toolbar') ||
                   cell.node.closest('.jp-Notebook')?.querySelector('.obsidian-floating-toolbar') ||
                   document.querySelector('.obsidian-floating-toolbar')) as HTMLElement | null;
  if (toolbar) {
    toolbar.querySelectorAll('.obsidian-tb-mode-btn').forEach(btn => {
      if (btn.getAttribute('data-mode') === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    updateToolbarDisabledState(toolbar, mode === 'rendered');
  }

  const editorNode = cell.node.querySelector('.jp-Cell-inputArea') as HTMLElement | null;
  const existingSplit = cell.node.querySelector('.obsidian-split-preview');
  const existingLive = cell.node.querySelector('.obsidian-live-preview');

  if (mode === 'rendered') {
    if (existingSplit) existingSplit.remove();
    if (existingLive) existingLive.remove();
    if (editorNode) {
      editorNode.classList.remove('obsidian-cell-split');
      editorNode.classList.remove('obsidian-cell-live');
    }
    cell.rendered = true;
    showNemeToast('Lesen (Leseansicht)');
    return;
  }

  // Modus ist nicht rendered -> Zelle muss unrendered (im Editor) sein
  cell.rendered = false;

  // Sicherstellen, dass der Event-Listener auf Quelltext-Änderungen aktiv ist
  if (!(cell as any)._obsidianListenerAttached) {
    (cell as any)._obsidianListenerAttached = true;
    cell.model.sharedModel.changed.connect(() => {
      updateActivePreview(cell);
    });
  }

  if (mode === 'source') {
    if (existingSplit) existingSplit.remove();
    if (existingLive) existingLive.remove();
    if (editorNode) {
      editorNode.classList.remove('obsidian-cell-split');
      editorNode.classList.remove('obsidian-cell-live');
    }
    cell.editor?.focus();
    showNemeToast('Quelle aktiv');
    return;
  }

  if (mode === 'split') {
    if (existingLive) existingLive.remove();
    if (editorNode) {
      editorNode.classList.remove('obsidian-cell-live');
      editorNode.classList.add('obsidian-cell-split');

      let splitPreview = existingSplit as HTMLElement | null;
      if (!splitPreview) {
        splitPreview = document.createElement('div');
        splitPreview.className = 'obsidian-split-preview';
        splitPreview.innerHTML = `
          <div class="obsidian-preview-header">
            <span>Live Vorschau links</span>
            <span class="obsidian-preview-badge"><span class="obsidian-preview-dot"></span> Live KaTeX</span>
          </div>
          <div class="obsidian-preview-body"></div>
        `;
        editorNode.appendChild(splitPreview);
      }
      updateActivePreview(cell);
    }
    cell.editor?.focus();
    showNemeToast('Live Vorschau links aktiv');
    return;
  }

  if (mode === 'live') {
    if (existingSplit) existingSplit.remove();
    if (editorNode) {
      editorNode.classList.remove('obsidian-cell-split');
      editorNode.classList.add('obsidian-cell-live');

      let livePreview = existingLive as HTMLElement | null;
      if (!livePreview) {
        livePreview = document.createElement('div');
        livePreview.className = 'obsidian-live-preview';
        livePreview.innerHTML = `
          <div class="obsidian-preview-header">
            <span>Live Vorschau unten (KaTeX & Markdown)</span>
            <span class="obsidian-preview-badge"><span class="obsidian-preview-dot"></span> Echtzeit</span>
          </div>
          <div class="obsidian-preview-body"></div>
        `;
        editorNode.appendChild(livePreview);
      }
      updateActivePreview(cell);
    }
    cell.editor?.focus();
    showNemeToast('Live Vorschau unten aktiv');
    return;
  }
}

/**
 * Ergänzt die Zell-Toolbar aktiver Code-Zellen um die Buttons "Play" und "Stop"
 */
function attachCodeCellToolbar(cell: any, notebookPanel: NotebookPanel, app: JupyterFrontEnd): void {
  if (!cell || !cell.node) return;

  // Suche nach der existierenden Zell-Toolbar oder erstelle eine saubere Leiste
  let toolbar = cell.node.querySelector('.jp-Cell-toolbar, .jp-cell-toolbar') as HTMLElement | null;
  if (!toolbar) {
    const inputWrapper = cell.node.querySelector('.jp-Cell-inputWrapper') || cell.node;
    toolbar = document.createElement('div');
    toolbar.className = 'jp-Cell-toolbar';
    if (inputWrapper.parentNode) {
      inputWrapper.parentNode.insertBefore(toolbar, inputWrapper);
    } else {
      cell.node.prepend(toolbar);
    }
  }

  // Verhindert doppeltes Einfügen
  if (toolbar.querySelector('.obsidian-code-play-btn')) return;

  const btnGroup = document.createElement('div');
  btnGroup.className = 'obsidian-code-actions-group';
  btnGroup.style.display = 'inline-flex';
  btnGroup.style.alignItems = 'center';
  btnGroup.style.gap = '4px';
  btnGroup.style.marginRight = '6px';

  // 1. Play Button (Zelle ausführen)
  const playBtn = document.createElement('button');
  playBtn.className = 'jp-ToolbarButtonComponent obsidian-code-play-btn';
  playBtn.title = 'Zelle ausführen (Play - Shift+Enter / Ctrl+Enter)';
  playBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="6 3 20 12 6 21 6 3"></polygon>
    </svg>
    <span>Play</span>
  `;
  playBtn.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      app.commands.execute('notebook:run-cell');
    } catch (_e) {
      try {
        (cell as any).execute(notebookPanel.sessionContext);
      } catch (err) {
        console.warn('Run cell fallback:', err);
      }
    }
  };

  // 2. Stop Button (Kernel unterbrechen / Ausführung anhalten)
  const stopBtn = document.createElement('button');
  stopBtn.className = 'jp-ToolbarButtonComponent obsidian-code-stop-btn';
  stopBtn.title = 'Kernel unterbrechen / Ausführung stoppen (Stop)';
  stopBtn.innerHTML = `
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="5" y="5" width="14" height="14" rx="2" ry="2"></rect>
    </svg>
    <span>Stop</span>
  `;
  stopBtn.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      app.commands.execute('notebook:interrupt-kernel');
    } catch (_e) {
      try {
        notebookPanel.sessionContext.session?.kernel?.interrupt();
      } catch (err) {
        console.warn('Interrupt kernel fallback:', err);
      }
    }
    showNemeToast('Kernel-Unterbrechung gesendet (Stop)');
  };

  btnGroup.appendChild(playBtn);
  btnGroup.appendChild(stopBtn);

  if (toolbar.firstChild) {
    toolbar.insertBefore(btnGroup, toolbar.firstChild);
  } else {
    toolbar.appendChild(btnGroup);
  }
}

/**
 * Hängt die vollständige NeME Dark Toolbar an die aktive Markdown-Zelle (darunter verankert)
 */
function attachNemeToolbar(cell: MarkdownCell): void {
  cell.node.classList.add('obsidian-markdown-cell');

  // Vorherige Toolbar-Instanz entfernen (verhindert Dopplungen)
  const existingToolbar = cell.node.querySelector('.obsidian-floating-toolbar');
  if (existingToolbar) existingToolbar.remove();

  // WICHTIG: Die Toolbar wird an den .jp-Cell-inputWrapper angehängt (DARUNTER)
  // und NIEMALS in .jp-Cell-inputArea geprependet (da diese ein horizontales Flex-Layout besitzt und die Toolbar nach links schiebt)
  const inputWrapper = cell.node.querySelector('.jp-Cell-inputWrapper') || cell.node;
  if (!inputWrapper) return;

  const toolbar = document.createElement('div');
  toolbar.className = 'obsidian-floating-toolbar';

  // Exakte Modus-Erkennung: Eine Zelle ohne Live-Preview DOM-Element ist 'source' (Quelle)
  const hasLive = !!cell.node.querySelector('.obsidian-live-preview');
  const hasSplit = !!cell.node.querySelector('.obsidian-split-preview');

  let curMode: 'live' | 'split' | 'source' | 'rendered' = (cell as any)._obsidianMode;
  if (!curMode) {
    if (hasLive) {
      curMode = 'live';
    } else if (hasSplit) {
      curMode = 'split';
    } else if (cell.rendered) {
      curMode = 'rendered';
    } else {
      // Eine neu erstellte Zelle in JupyterLab startet als reiner Quelltext-Editor -> Modus 'source'
      curMode = (cell as any)._lastEditMode || 'source';
    }
    (cell as any)._obsidianMode = curMode;
  } else if (!cell.rendered) {
    // Wenn die Zelle editiert wird, prüfen ob die Vorschau-Container tatsächlich existieren
    if (curMode === 'rendered') {
      curMode = hasLive ? 'live' : hasSplit ? 'split' : ((cell as any)._lastEditMode || 'source');
      (cell as any)._obsidianMode = curMode;
    } else if (curMode === 'live' && !hasLive) {
      // Wurde als 'live' geführt, aber Live-Vorschau DOM fehlt -> Zelle ist tatsächlich 'source'
      curMode = 'source';
      (cell as any)._obsidianMode = 'source';
    } else if (curMode === 'split' && !hasSplit) {
      curMode = 'source';
      (cell as any)._obsidianMode = 'source';
    }
  } else if (cell.rendered) {
    curMode = 'rendered';
    (cell as any)._obsidianMode = 'rendered';
  }

  toolbar.innerHTML = `
    <div class="obsidian-tb-brand">NeME</div>

    <!-- Überschriften Dropdown -->
    <div class="obsidian-dropdown-container">
      <button class="obsidian-tb-btn obsidian-dropdown-toggle" title="Überschriften">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 12h12M6 20V4M18 20V4"/></svg>
        <span>H</span>
      </button>
      <div class="obsidian-dropdown-menu">
        <button class="obsidian-dropdown-item" data-action="h1"><b>H1 Überschrift</b></button>
        <button class="obsidian-dropdown-item" data-action="h2"><b>H2 Untertitel</b></button>
        <button class="obsidian-dropdown-item" data-action="h3"><b>H3 Abschnitt</b></button>
      </div>
    </div>

    <div class="obsidian-tb-divider"></div>

    <!-- Formatierungen -->
    <button class="obsidian-tb-btn" title="Fett (Strg+B)" data-action="bold">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 12h9a4 4 0 0 1 0 8H6v-8zm0 0h8a3.5 3.5 0 0 0 0-7H6v7z"/></svg>
    </button>
    <button class="obsidian-tb-btn" title="Kursiv (Strg+I)" data-action="italic">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
    </button>
    <button class="obsidian-tb-btn" title="Durchgestrichen" data-action="strike">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
    </button>
    <button class="obsidian-tb-btn" title="Markieren (==text==)" data-action="highlight">
      <span style="background: rgba(251, 191, 36, 0.2); color: #fbbf24; padding: 0 3px; border-radius: 2px;">==</span>
    </button>
    <button class="obsidian-tb-btn" title="Inline-Code" data-action="code">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
    </button>
    <button class="obsidian-tb-btn" title="Formatierung löschen" data-action="clear-format">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><path d="M5 20h6"/><path d="M13 4 8 20"/><path d="m15 15 5 5"/><path d="m20 15-5 5"/></svg>
    </button>

    <div class="obsidian-tb-divider"></div>

    <!-- Listen -->
    <button class="obsidian-tb-btn" title="Aufzählung (- )" data-action="bullet">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
    </button>
    <button class="obsidian-tb-btn" title="Checkliste (- [ ] )" data-action="checklist">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
    </button>

    <div class="obsidian-tb-divider"></div>

    <!-- Interaktive Formeln & Tabellen -->
    <button class="obsidian-tb-btn" title="LaTeX Formel-Editor öffnen" data-action="math" style="color: #c084fc;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 7V4H6l6 8-6 8h12v-3"/></svg>
      <span>Formel</span>
    </button>

    <button class="obsidian-tb-btn" title="Interaktiven Tabellen-Editor öffnen" data-action="table" style="color: #38bdf8;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>
      <span>Tabelle</span>
    </button>

    <!-- Callouts Dropdown -->
    <div class="obsidian-dropdown-container">
      <button class="obsidian-tb-btn obsidian-dropdown-toggle" title="NeME Callouts">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>
        <span>Callout</span>
      </button>
      <div class="obsidian-dropdown-menu">
        <button class="obsidian-dropdown-item" data-action="callout-note" style="color: #38bdf8;">[!NOTE] Hinweis</button>
        <button class="obsidian-dropdown-item" data-action="callout-tip" style="color: #34d399;">[!TIP] Tipp</button>
        <button class="obsidian-dropdown-item" data-action="callout-warning" style="color: #fbbf24;">[!WARNING] Warnung</button>
        <button class="obsidian-dropdown-item" data-action="callout-caution" style="color: #f87171;">[!CAUTION] Achtung</button>
        <button class="obsidian-dropdown-item" data-action="callout-important" style="color: #c084fc;">[!IMPORTANT] Wichtig</button>
      </div>
    </div>

    <div class="obsidian-tb-divider"></div>

    <!-- Modus-Umschaltung: Live Vorschau unten, Live Vorschau links, Quelle, Lesen -->
    <div class="obsidian-tb-mode-group">
      <button class="obsidian-tb-mode-btn ${curMode === 'live' ? 'active' : ''}" data-mode="live" title="Live Vorschau unten: Editor mit Live-Vorschau darunter">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        <span>Live Vorschau unten</span>
      </button>
      <button class="obsidian-tb-mode-btn ${curMode === 'split' ? 'active' : ''}" data-mode="split" title="Live Vorschau links: Live-Vorschau links, Quellcode rechts">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z"/></svg>
        <span>Live Vorschau links</span>
      </button>
      <button class="obsidian-tb-mode-btn ${curMode === 'source' ? 'active' : ''}" data-mode="source" title="Quelle: Reiner Markdown Quellcode">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        <span>Quelle</span>
      </button>
      <button class="obsidian-tb-mode-btn ${curMode === 'rendered' ? 'active' : ''}" data-mode="rendered" title="Lesen: Fertige Leseansicht">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        <span>Lesen</span>
      </button>
    </div>
  `;

  // Dropdown-Toggle Logik
  toolbar.querySelectorAll('.obsidian-dropdown-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if ((cell as any)._obsidianMode === 'rendered' || cell.rendered) return;
      const parent = btn.closest('.obsidian-dropdown-container');
      const menu = parent?.querySelector('.obsidian-dropdown-menu');
      document.querySelectorAll('.obsidian-dropdown-menu').forEach(m => {
        if (m !== menu) m.classList.remove('show');
      });
      menu?.classList.toggle('show');
    });
  });

  // Schließe Menüs bei Klick außerhalb
  document.addEventListener('click', () => {
    document.querySelectorAll('.obsidian-dropdown-menu').forEach(m => m.classList.remove('show'));
  });

  // Modus-Button Klick Aktionen (Live Preview, Split, Source, Gelesen)
  toolbar.querySelectorAll('.obsidian-tb-mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = btn.getAttribute('data-mode') as 'live' | 'split' | 'source' | 'rendered';
      if (mode) {
        setCellEditorMode(cell, mode);
      }
    });
  });

  // Klick-Aktionen auf Standard-Buttons
  toolbar.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const action = btn.getAttribute('data-action');
      handleToolbarAction(cell, action);
    });
  });

  // Toolbar Buttons deaktivieren wenn Zelle im Lesemodus ist
  updateToolbarDisabledState(toolbar, curMode === 'rendered');

  // Synchronisation NUR bei Doppelklick (Capturing Phase, bevor JupyterLab event.stopPropagation ausführt!)
  if (!(cell as any)._obsidianDblClickAttached) {
    (cell as any)._obsidianDblClickAttached = true;
    cell.node.addEventListener('dblclick', (e) => {
      // Nicht auslösen wenn direkt auf Toolbar-Buttons geklickt wurde
      if ((e.target as HTMLElement)?.closest('.obsidian-floating-toolbar')) return;
      setTimeout(() => {
        if ((cell as any)._obsidianMode === 'rendered') {
          const nextMode = (cell as any)._lastEditMode || 'source';
          setCellEditorMode(cell, nextMode);
        }
      }, 50);
    }, true);
  }

  // Tastatur-Enter Erkennung (JupyterLab Command Mode -> Edit Mode bei Tastendruck Enter)
  if (!(cell as any)._obsidianEnterAttached) {
    (cell as any)._obsidianEnterAttached = true;
    cell.node.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setTimeout(() => {
          if ((cell as any)._obsidianMode === 'rendered') {
            const nextMode = (cell as any)._lastEditMode || 'source';
            setCellEditorMode(cell, nextMode);
          }
        }, 50);
      }
    });
  }

  // Fest DARUNTER an den inputWrapper anheften
  inputWrapper.appendChild(toolbar);
}

function stripMarkdownFormatting(text: string): string {
  if (!text) return '';
  let res = text;
  res = res.replace(new RegExp('\\x60{3}[a-zA-Z0-9_-]*\\n?([\\s\\S]*?)\\x60{3}', 'g'), '$1');
  res = res.replace(/\$\$([\s\S]*?)\$\$/g, '$1');
  const inlineRegex = /(?<![\$\\])\$(?!\$)([^\$\n]+?)(?<![\$\\])\$(?!\$)/g;
  res = res.replace(inlineRegex, '$1');
  res = res.replace(/!\[(.*?)\]\(.*?\)/g, '$1');
  res = res.replace(/\[(.*?)\]\(.*?\)/g, '$1');
  res = res.replace(/\[\[(?:.*?\|)?(.*?)\]\]/g, '$1');
  res = res.replace(/(\*{2,3}|_{2,3})(.*?)\1/g, '$2');
  res = res.replace(/\*([^\*\n]+?)\*/g, '$1');
  res = res.replace(/\b_([^\_\n]+?)_\b/g, '$1');
  res = res.replace(/~~(.*?)~~/g, '$1');
  res = res.replace(/==(.*?)==/g, '$1');
  res = res.replace(new RegExp('\\x60([^\\x60\\n]+?)\\x60', 'g'), '$1');
  res = res.replace(/<\/?[a-zA-Z0-9]+(?:\s+[^>]*)?>/g, '');
  res = res.replace(/^[ \t]*(?:#{1,6}|>+|- \[[ xX]\]|[-*+]|\d+\.)[ \t]+/gm, '');
  return res;
}

function clearFormattingInCell(cell: MarkdownCell): void {
  const editor = cell.editor;
  if (!editor) return;

  try {
    const selection = editor.getSelection();
    const src = cell.model.sharedModel.getSource();
    if (selection && typeof editor.getOffsetAt === 'function') {
      const startOffset = editor.getOffsetAt(selection.start);
      const endOffset = editor.getOffsetAt(selection.end);
      if (startOffset !== endOffset) {
        const selectedText = src.substring(startOffset, endOffset);
        const cleaned = stripMarkdownFormatting(selectedText);
        cell.model.sharedModel.setSource(src.substring(0, startOffset) + cleaned + src.substring(endOffset));

        setTimeout(() => {
          try {
            editor.focus();
            if (typeof editor.getPositionAt === 'function') {
              const newStartPos = editor.getPositionAt(startOffset);
              const newEndPos = editor.getPositionAt(startOffset + cleaned.length);
              if (newStartPos && newEndPos) {
                editor.setSelection({ start: newStartPos, end: newEndPos });
              }
            } else {
              editor.setCursorPosition(selection.start);
            }
          } catch (err) {
            console.error('Could not restore selection', err);
          }
        }, 20);

        showNemeToast('Formatierung gelöscht');
        return;
      }
    }
    const pos = editor.getCursorPosition();
    const lines = src.split('\n');
    if (lines[pos.line] !== undefined) {
      const originalLine = lines[pos.line];
      const prefixBeforeCursor = originalLine.substring(0, pos.column);
      const cleanedPrefix = stripMarkdownFormatting(prefixBeforeCursor);
      const cleanedLine = stripMarkdownFormatting(originalLine);
      const newColumn = Math.min(cleanedPrefix.length, cleanedLine.length);

      lines[pos.line] = cleanedLine;
      cell.model.sharedModel.setSource(lines.join('\n'));

      setTimeout(() => {
        try {
          editor.focus();
          editor.setCursorPosition({ line: pos.line, column: newColumn });
        } catch (err) {
          console.error('Could not restore cursor position', err);
        }
      }, 20);

      showNemeToast('Formatierung gelöscht');
    }
  } catch (e) {
    console.error('Error clearing formatting', e);
  }
}

function handleToolbarAction(cell: MarkdownCell, action: string | null): void {
  if (!action) return;
  if (cell.rendered || (cell as any)._obsidianMode === 'rendered') return;

  switch (action) {
    case 'h1': insertLinePrefix(cell, '# '); break;
    case 'h2': insertLinePrefix(cell, '## '); break;
    case 'h3': insertLinePrefix(cell, '### '); break;
    case 'bold': insertAroundSelection(cell, '**', '**', 'fetter Text'); break;
    case 'italic': insertAroundSelection(cell, '*', '*', 'kursiver Text'); break;
    case 'strike': insertAroundSelection(cell, '~~', '~~', 'durchgestrichen'); break;
    case 'highlight': insertAroundSelection(cell, '==', '==', 'markierter Text'); break;
    case 'code': insertAroundSelection(cell, '`', '`', 'code'); break;
    case 'clear-format': clearFormattingInCell(cell); break;
    case 'bullet': insertLinePrefix(cell, '- '); break;
    case 'checklist': insertLinePrefix(cell, '- [ ] '); break;
    case 'math': openMathEditorModal(cell); break;
    case 'table': openTableEditorModal(cell); break;
    case 'callout-note': insertAroundSelection(cell, '\n> [!NOTE]\n> ', '\n', 'Wichtiger Hinweis hier...'); break;
    case 'callout-tip': insertAroundSelection(cell, '\n> [!TIP]\n> ', '\n', 'Praktischer Tipp hier...'); break;
    case 'callout-warning': insertAroundSelection(cell, '\n> [!WARNING]\n> ', '\n', 'Warnung hier...'); break;
    case 'callout-caution': insertAroundSelection(cell, '\n> [!CAUTION]\n> ', '\n', 'Gefahr hier...'); break;
    case 'callout-important': insertAroundSelection(cell, '\n> [!IMPORTANT]\n> ', '\n', 'Wichtige Info...'); break;
    case 'render': cell.rendered = true; break;
  }
}

function insertAroundSelection(cell: MarkdownCell, before: string, after: string, defaultText: string): void {
  const editor = cell.editor;
  if (!editor) {
    const current = cell.model.sharedModel.getSource();
    cell.model.sharedModel.setSource(current + '\n' + before + defaultText + after);
    return;
  }

  let selectedText = '';
  let startOffset = -1;
  try {
    const selection = editor.getSelection();
    if (selection && typeof editor.getOffsetAt === 'function') {
      const src = cell.model.sharedModel.getSource();
      startOffset = editor.getOffsetAt(selection.start);
      const endOffset = editor.getOffsetAt(selection.end);
      selectedText = src.substring(startOffset, endOffset);
    }
  } catch (_e) {
    selectedText = '';
  }

  const textToInsert = selectedText ? `${before}${selectedText}${after}` : `${before}${defaultText}${after}`;

  if (typeof editor.replaceSelection === 'function') {
    editor.replaceSelection(textToInsert);
  } else {
    const current = cell.model.sharedModel.getSource();
    cell.model.sharedModel.setSource(current + '\n' + textToInsert);
  }

  // Erweitere die Markierung auf die Formatierungszeichen (Präfix & Suffix)
  if (before || after) {
    setTimeout(() => {
      try {
        editor.focus();
        if (typeof editor.getPositionAt === 'function' && startOffset >= 0) {
          const newStartPos = editor.getPositionAt(startOffset);
          const newEndPos = editor.getPositionAt(startOffset + textToInsert.length);
          if (newStartPos && newEndPos) {
            editor.setSelection({ start: newStartPos, end: newEndPos });
          }
        }
      } catch (_e) {
        // fallback
      }
    }, 15);
  }
}

function insertLinePrefix(cell: MarkdownCell, prefix: string): void {
  const editor = cell.editor;
  if (!editor) {
    cell.model.sharedModel.setSource(prefix + cell.model.sharedModel.getSource());
    return;
  }

  const selection = editor.getSelection();
  const src = cell.model.sharedModel.getSource();
  const startOffset = typeof editor.getOffsetAt === 'function' ? editor.getOffsetAt(selection.start) : 0;
  const endOffset = typeof editor.getOffsetAt === 'function' ? editor.getOffsetAt(selection.end) : 0;
  const lineStart = src.lastIndexOf('\n', startOffset - 1) + 1;

  const newContent = src.substring(0, lineStart) + prefix + src.substring(lineStart);
  cell.model.sharedModel.setSource(newContent);

  setTimeout(() => {
    try {
      editor.focus();
      if (typeof editor.getPositionAt === 'function') {
        if (startOffset !== endOffset) {
          const sPos = editor.getPositionAt(lineStart);
          const ePos = editor.getPositionAt(endOffset + prefix.length);
          if (sPos && ePos) {
            editor.setSelection({ start: sPos, end: ePos });
          }
        } else {
          const targetPos = editor.getPositionAt(startOffset + prefix.length);
          if (targetPos) {
            editor.setCursorPosition(targetPos);
          }
        }
      }
    } catch (_e) {
      // fallback
    }
  }, 15);
}

/**
 * Parsen einer Markdown-Tabelle
 */
function parseMarkdownTable(raw: string) {
  const lines = raw.trim().split('\n').filter(l => l.trim().startsWith('|') && l.trim().endsWith('|'));
  if (lines.length < 2) return null;

  const headers = lines[0].split('|').slice(1, -1).map(c => c.trim());
  const alignLine = lines[1].split('|').slice(1, -1).map(c => c.trim());
  const alignments = alignLine.map(c => {
    if (c.startsWith(':') && c.endsWith(':')) return 'center';
    if (c.endsWith(':')) return 'right';
    return 'left';
  });
  const rows = lines.slice(2).map(r => r.split('|').slice(1, -1).map(c => c.trim()));
  return { headers, alignments, rows };
}

/**
 * Generieren von Markdown aus Tabellen-Daten
 */
function generateMarkdownTable(headers: string[], alignments: string[], rows: string[][]): string {
  let md = '| ' + headers.join(' | ') + ' |\n';
  md += '| ' + alignments.map(a => a === 'center' ? ':---:' : a === 'right' ? '---:' : '---').join(' | ') + ' |\n';
  for (const r of rows) {
    const padded = headers.map((_, i) => r[i] !== undefined ? r[i] : '');
    md += '| ' + padded.join(' | ') + ' |\n';
  }
  return md;
}

/**
 * Findet alle Markdown-Tabellen im Quelltext
 */
function extractAllMarkdownTables(src: string): string[] {
  const results: string[] = [];
  const lines = src.split('\n');
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      current.push(line);
    } else {
      if (current.length >= 2) results.push(current.join('\n'));
      current = [];
    }
  }
  if (current.length >= 2) results.push(current.join('\n'));
  return results;
}

/**
 * INTERAKTIVER TABELLEN-EDITOR (Erstellen & In-Place Bearbeiten)
 */
function openTableEditorModal(cell: MarkdownCell, initialTableMarkdown?: string): void {
  const existing = document.getElementById('obsidian-table-modal');
  if (existing) existing.remove();

  let tableData = initialTableMarkdown ? parseMarkdownTable(initialTableMarkdown) : null;
  if (!tableData) {
    tableData = {
      headers: ['A', 'B', 'C'],
      alignments: ['left', 'left', 'left'],
      rows: [
        ['1', '2', '3'],
        ['4', '5', '6']
      ]
    };
  }

  let currentHeaders = [...tableData.headers];
  let currentAlignments = [...tableData.alignments];
  let currentRows = tableData.rows.map(r => [...r]);

  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'obsidian-table-modal';
  modalOverlay.className = 'obsidian-modal-overlay';

  const isEditing = Boolean(initialTableMarkdown && initialTableMarkdown.trim().length > 0);

  modalOverlay.innerHTML = `
    <div class="obsidian-modal" style="max-width: 720px;">
      <div class="obsidian-modal-header">
        <h3>${isEditing ? 'Markdown-Tabelle bearbeiten' : 'Neue Tabelle erstellen'}</h3>
        <button class="obsidian-modal-close">&times;</button>
      </div>
      <div class="obsidian-modal-body">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div style="display: flex; gap: 8px;">
            <button class="obsidian-btn obsidian-btn-sec" id="tb-add-col">+ Spalte hinzufügen</button>
            <button class="obsidian-btn obsidian-btn-sec" id="tb-del-col">- Spalte entfernen</button>
            <button class="obsidian-btn obsidian-btn-sec" id="tb-add-row">+ Zeile hinzufügen</button>
            <button class="obsidian-btn obsidian-btn-sec" id="tb-del-row">- Zeile entfernen</button>
          </div>
          <span style="font-size: 12px; color: #a1a1aa;" id="tb-dim-label"></span>
        </div>

        <div style="max-height: 380px; overflow: auto; border: 1px solid #3f3f46; border-radius: 8px; padding: 4px;">
          <table class="obsidian-table-grid" id="tb-grid"></table>
        </div>

        <div style="margin-top: 14px;">
          <label style="font-size: 11px; font-weight: 600; color: #a1a1aa; text-transform: uppercase;">Markdown Vorschau:</label>
          <pre id="tb-md-preview" style="background: #09090b; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 11px; color: #38bdf8; overflow-x: auto; margin-top: 4px;"></pre>
        </div>
      </div>
      <div class="obsidian-modal-footer">
        <button class="obsidian-btn obsidian-btn-sec" id="tb-cancel">Abbrechen</button>
        <button class="obsidian-btn obsidian-btn-pri" id="tb-save">${isEditing ? 'Tabelle aktualisieren' : 'In Zelle einfügen'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);

  const gridTable = modalOverlay.querySelector('#tb-grid') as HTMLTableElement;
  const mdPreview = modalOverlay.querySelector('#tb-md-preview') as HTMLPreElement;
  const dimLabel = modalOverlay.querySelector('#tb-dim-label') as HTMLSpanElement;

  function renderGrid(): void {
    dimLabel.textContent = `${currentHeaders.length} Spalten × ${currentRows.length} Zeilen`;
    gridTable.innerHTML = '';

    // Header Zeile
    const thead = document.createElement('thead');
    const headerTr = document.createElement('tr');
    currentHeaders.forEach((h, colIdx) => {
      const th = document.createElement('th');
      th.innerHTML = `
        <div class="obsidian-col-ctrl">
          <button data-align="left" title="Linksbündig">L</button>
          <button data-align="center" title="Zentriert">C</button>
          <button data-align="right" title="Rechtsbündig">R</button>
        </div>
        <input type="text" value="${h}" placeholder="${String.fromCharCode(65 + (colIdx % 26))}" data-header="${colIdx}" />
      `;
      th.querySelectorAll('[data-align]').forEach(btn => {
        btn.addEventListener('click', () => {
          const a = btn.getAttribute('data-align') as 'left' | 'center' | 'right';
          currentAlignments[colIdx] = a;
          updatePreview();
        });
      });
      th.querySelector('input')?.addEventListener('input', (e) => {
        currentHeaders[colIdx] = (e.target as HTMLInputElement).value;
        updatePreview();
      });
      headerTr.appendChild(th);
    });
    thead.appendChild(headerTr);
    gridTable.appendChild(thead);

    // Body Zeilen
    const tbody = document.createElement('tbody');
    currentRows.forEach((row, rowIdx) => {
      const tr = document.createElement('tr');
      currentHeaders.forEach((_, colIdx) => {
        const td = document.createElement('td');
        const val = row[colIdx] !== undefined ? row[colIdx] : '';
        td.innerHTML = `<input type="text" value="${val}" placeholder="–" data-row="${rowIdx}" data-col="${colIdx}" />`;
        td.querySelector('input')?.addEventListener('input', (e) => {
          currentRows[rowIdx][colIdx] = (e.target as HTMLInputElement).value;
          updatePreview();
        });
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    gridTable.appendChild(tbody);

    updatePreview();
  }

  function updatePreview(): void {
    mdPreview.textContent = generateMarkdownTable(currentHeaders, currentAlignments, currentRows);
  }

  modalOverlay.querySelector('#tb-add-col')?.addEventListener('click', () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nextCol = letters[currentHeaders.length % 26] || `C${currentHeaders.length + 1}`;
    currentHeaders.push(nextCol);
    currentAlignments.push('left');
    currentRows.forEach((r, idx) => r.push(String(idx + 1)));
    renderGrid();
  });

  modalOverlay.querySelector('#tb-del-col')?.addEventListener('click', () => {
    if (currentHeaders.length <= 1) return;
    currentHeaders.pop();
    currentAlignments.pop();
    currentRows.forEach(r => r.pop());
    renderGrid();
  });

  modalOverlay.querySelector('#tb-add-row')?.addEventListener('click', () => {
    const rIdx = currentRows.length;
    currentRows.push(new Array(currentHeaders.length).fill('').map((_, c) => `${(rIdx * currentHeaders.length) + c + 1}`));
    renderGrid();
  });

  modalOverlay.querySelector('#tb-del-row')?.addEventListener('click', () => {
    if (currentRows.length <= 1) return;
    currentRows.pop();
    renderGrid();
  });

  const close = () => modalOverlay.remove();
  modalOverlay.querySelector('.obsidian-modal-close')?.addEventListener('click', close);
  modalOverlay.querySelector('#tb-cancel')?.addEventListener('click', close);

  modalOverlay.querySelector('#tb-save')?.addEventListener('click', () => {
    const finalMd = generateMarkdownTable(currentHeaders, currentAlignments, currentRows);
    if (initialTableMarkdown) {
      // In-Place Update der existierenden Tabelle
      const src = cell.model.sharedModel.getSource();
      if (src.includes(initialTableMarkdown.trim())) {
        cell.model.sharedModel.setSource(src.replace(initialTableMarkdown.trim(), finalMd.trim()));
      } else {
        insertAroundSelection(cell, '', '', '\n' + finalMd + '\n');
      }
    } else {
      insertAroundSelection(cell, '', '', '\n' + finalMd + '\n');
    }
    close();
  });

  renderGrid();
}

/**
 * Extrahiert alle mathematischen Formeln (Block & Inline) im Original-LaTeX aus dem Markdown-Quelltext der Zelle
 */
interface ExtractedFormula {
  raw: string;
  latex: string;
  isBlock: boolean;
  start: number;
  end: number;
}

function extractAllFormulasFromMarkdown(src: string): ExtractedFormula[] {
  const list: ExtractedFormula[] = [];

  // 1. Block-Formeln: $$ ... $$
  const blockRegex = /\$\$([\s\S]*?)\$\$/g;
  let bMatch: RegExpExecArray | null;
  while ((bMatch = blockRegex.exec(src)) !== null) {
    list.push({
      raw: bMatch[0],
      latex: bMatch[1].trim(),
      isBlock: true,
      start: bMatch.index,
      end: bMatch.index + bMatch[0].length
    });
  }

  // 2. Inline-Formeln: $ ... $ (keine Newlines, keine angrenzenden $$)
  const inlineRegex = /(?<![\$\\])\$(?!\$)([^\$\n]+?)(?<![\$\\])\$(?!\$)/g;
  let iMatch: RegExpExecArray | null;
  while ((iMatch = inlineRegex.exec(src)) !== null) {
    const start = iMatch.index;
    const end = iMatch.index + iMatch[0].length;
    if (!list.some(b => b.isBlock && start >= b.start && end <= b.end)) {
      list.push({
        raw: iMatch[0],
        latex: iMatch[1].trim(),
        isBlock: false,
        start,
        end
      });
    }
  }

  list.sort((a, b) => a.start - b.start);
  return list;
}

/**
 * INTERAKTIVER FORMEL-EDITOR (Erstellen & In-Place Bearbeiten mit Live KaTeX)
 */
function openMathEditorModal(cell: MarkdownCell, initialFormulaMarkdown?: string, initialLatex?: string, initialIsBlock?: boolean, initialStart?: number, initialEnd?: number): void {
  const existing = document.getElementById('obsidian-math-modal');
  if (existing) existing.remove();

  let isBlock = initialIsBlock !== undefined ? initialIsBlock : true;
  let currentLatex = initialLatex !== undefined && initialLatex !== '' ? initialLatex : '\\mathbf{A}\\mathbf{x} = \\mathbf{b}';

  if (initialFormulaMarkdown) {
    const trimmed = initialFormulaMarkdown.trim();
    if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4) {
      currentLatex = trimmed.slice(2, -2).trim();
      isBlock = true;
    } else if (trimmed.startsWith('$') && trimmed.endsWith('$') && trimmed.length >= 2 && !trimmed.startsWith('$$')) {
      currentLatex = trimmed.slice(1, -1).trim();
      if (initialIsBlock === undefined) {
        isBlock = false;
      }
    }
  }

  const isEditing = Boolean(initialFormulaMarkdown || (initialLatex && initialLatex.trim().length > 0));
  const originalLatex = currentLatex;

  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'obsidian-math-modal';
  modalOverlay.className = 'obsidian-modal-overlay';

  modalOverlay.innerHTML = `
    <div class="obsidian-modal" style="max-width: 660px;">
      <div class="obsidian-modal-header">
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.2"><path d="M18 7V4H6l6 8-6 8h12v-3"/></svg>
          <span>${isEditing ? 'Formel bearbeiten' : 'LaTeX Formel-Editor'}</span>
        </h3>
        <button class="obsidian-modal-close">&times;</button>
      </div>
      <div class="obsidian-modal-body">
        <p style="font-size: 12px; color: #a1a1aa; margin: 0 0 12px 0;">
          ${isEditing ? 'Bestehende Formel in dieser Zelle anpassen und aktualisieren' : 'Mathematische Ausdrücke & Data-Science Formeln intuitiv einfügen'}
        </p>

        <!-- Schnellauswahl Chips -->
        <div class="obsidian-chips-group">
          <div class="obsidian-chips-title">Matrizen & Vektoren</div>
          <div class="obsidian-chips-row">
            <button class="obsidian-chip" data-tex="\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}">(2x2 Matrix)</button>
            <button class="obsidian-chip" data-tex="\\begin{bmatrix} a_{11} & a_{12} & a_{13} \\\\ a_{21} & a_{22} & a_{23} \\\\ a_{31} & a_{32} & a_{33} \\end{bmatrix}">[3x3 Matrix]</button>
            <button class="obsidian-chip" data-tex="\\mathbf{v} = \\begin{pmatrix} v_1 \\\\ v_2 \\\\ v_3 \\end{pmatrix}">[Spaltenvektor]</button>
          </div>

          <div class="obsidian-chips-title">Operatoren & Bausteine</div>
          <div class="obsidian-chips-row">
            <button class="obsidian-chip" data-tex="\\frac{a}{b}">Bruch (\\frac)</button>
            <button class="obsidian-chip" data-tex="\\dfrac{a}{b}">Display-Bruch (\\dfrac)</button>
            <button class="obsidian-chip" data-tex="\\text{.}">Formatierung \\text{.}</button>
            <button class="obsidian-chip" data-tex="x^{2}">Potenz (x^2)</button>
            <button class="obsidian-chip" data-tex="x_{i}">Index (x_i)</button>
            <button class="obsidian-chip" data-tex="\\sqrt{x}">Wurzel (\\sqrt)</button>
            <button class="obsidian-chip" data-tex="\\sqrt[n]{x}">n-te Wurzel</button>
            <button class="obsidian-chip" data-tex="\\infty">∞</button>
            <button class="obsidian-chip" data-tex="\\nabla">∇</button>
            <button class="obsidian-chip" data-tex="\\in">∈</button>
            <button class="obsidian-chip" data-tex="\\subset">⊂</button>
            <button class="obsidian-chip" data-tex="\\approx">≈</button>
            <button class="obsidian-chip" data-tex="\\neq">≠</button>
            <button class="obsidian-chip" data-tex="\\le">≤</button>
            <button class="obsidian-chip" data-tex="\\ge">≥</button>
            <button class="obsidian-chip" data-tex="\\pm">±</button>
          </div>

          <div class="obsidian-chips-title">Griechische Symbole</div>
          <div class="obsidian-chips-row">
            <button class="obsidian-chip" data-tex="\\alpha">α (alpha)</button>
            <button class="obsidian-chip" data-tex="\\beta">β (beta)</button>
            <button class="obsidian-chip" data-tex="\\gamma">γ (gamma)</button>
            <button class="obsidian-chip" data-tex="\\delta">δ (delta)</button>
            <button class="obsidian-chip" data-tex="\\epsilon">ε (epsilon)</button>
            <button class="obsidian-chip" data-tex="\\theta">θ (theta)</button>
            <button class="obsidian-chip" data-tex="\\lambda">λ (lambda)</button>
            <button class="obsidian-chip" data-tex="\\mu">μ (mu)</button>
            <button class="obsidian-chip" data-tex="\\pi">π (pi)</button>
            <button class="obsidian-chip" data-tex="\\sigma">σ (sigma)</button>
            <button class="obsidian-chip" data-tex="\\tau">τ (tau)</button>
            <button class="obsidian-chip" data-tex="\\phi">φ (phi)</button>
            <button class="obsidian-chip" data-tex="\\psi">ψ (psi)</button>
            <button class="obsidian-chip" data-tex="\\omega">ω (omega)</button>
            <button class="obsidian-chip" data-tex="\\Delta">Δ (Delta)</button>
            <button class="obsidian-chip" data-tex="\\Theta">Θ (Theta)</button>
            <button class="obsidian-chip" data-tex="\\Lambda">Λ (Lambda)</button>
            <button class="obsidian-chip" data-tex="\\Sigma">Σ (Sigma)</button>
            <button class="obsidian-chip" data-tex="\\Omega">Ω (Omega)</button>
          </div>
        </div>

        <label style="font-size: 11px; font-weight: 600; color: #a1a1aa; text-transform: uppercase;">LaTeX Code:</label>
        <textarea id="math-tex-input" rows="3" style="width: 100%; box-sizing: border-box; background: #09090b; border: 1px solid #3f3f46; color: #f4f4f5; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 13px; margin: 4px 0 10px 0;"></textarea>

        <div style="display: flex; gap: 1rem; font-size: 13px; color: #d4d4d8; margin-bottom: 12px;">
          <label><input type="radio" name="math-mode" value="inline" ${!isBlock ? 'checked' : ''}> Im Fließtext ($...$)</label>
          <label><input type="radio" name="math-mode" value="block" ${isBlock ? 'checked' : ''}> Eigene Zeile / Block ($$...$$)</label>
        </div>

        <label style="font-size: 11px; font-weight: 600; color: #a1a1aa; text-transform: uppercase;">Echtzeit KaTeX Vorschau:</label>
        <div id="math-katex-preview" class="obsidian-math-preview"></div>
      </div>
      <div class="obsidian-modal-footer">
        <button class="obsidian-btn obsidian-btn-sec" id="math-cancel">Abbrechen</button>
        <button class="obsidian-btn obsidian-btn-pri" id="math-save" style="background: #d97706; border-color: #b45309;">${isEditing ? 'Formel aktualisieren' : 'In Zelle einfügen'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);

  const texInput = modalOverlay.querySelector('#math-tex-input') as HTMLTextAreaElement;
  const previewDiv = modalOverlay.querySelector('#math-katex-preview') as HTMLDivElement;
  texInput.value = currentLatex;

  function renderMathPreview(): void {
    const mode = (modalOverlay.querySelector('input[name="math-mode"]:checked') as HTMLInputElement)?.value === 'block';
    previewDiv.innerHTML = renderKaTeXPreview(texInput.value, mode);
  }

  texInput.addEventListener('input', () => {
    currentLatex = texInput.value;
    renderMathPreview();
  });

  modalOverlay.querySelectorAll('input[name="math-mode"]').forEach(radio => {
    radio.addEventListener('change', renderMathPreview);
  });

  modalOverlay.querySelectorAll('.obsidian-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const tex = chip.getAttribute('data-tex');
      if (tex) {
        const start = texInput.selectionStart;
        const end = texInput.selectionEnd;
        if (tex === '\\text{.}' && start !== undefined && end !== undefined && start !== end) {
          const selected = texInput.value.substring(start, end);
          const wrapped = '\\text{' + selected + '}';
          texInput.value = texInput.value.substring(0, start) + wrapped + texInput.value.substring(end);
        } else if (start !== undefined && end !== undefined && start !== end) {
          texInput.value = texInput.value.substring(0, start) + tex + texInput.value.substring(end);
        } else if (start !== undefined && end !== undefined) {
          texInput.value = texInput.value.substring(0, start) + tex + texInput.value.substring(start);
        } else {
          texInput.value = tex;
        }
        currentLatex = texInput.value;
        renderMathPreview();
        texInput.focus();
      }
    });
  });

  const close = () => modalOverlay.remove();
  modalOverlay.querySelector('.obsidian-modal-close')?.addEventListener('click', close);
  modalOverlay.querySelector('#math-cancel')?.addEventListener('click', close);

  modalOverlay.querySelector('#math-save')?.addEventListener('click', () => {
    const isBlockMode = (modalOverlay.querySelector('input[name="math-mode"]:checked') as HTMLInputElement)?.value === 'block';
    const cleanTex = texInput.value.trim();
    // Block-Formeln in Markdown immer isoliert auf eigenen Zeilen halten, damit sie stabil als Block gerendert werden
    const formatted = isBlockMode
      ? (cleanTex.includes('\n') ? `\n\n$$\n${cleanTex}\n$$\n\n` : `\n\n$$\n${cleanTex}\n$$\n\n`)
      : `$${cleanTex}$`;

    const src = cell.model.sharedModel.getSource();

    let replaced = false;

    // Priorität 1: Exakte Zeichenkoordinaten (Start / End) prüfen
    if (initialStart !== undefined && initialEnd !== undefined && initialStart >= 0 && initialEnd > initialStart) {
      if (initialFormulaMarkdown) {
        const sliceAtCoords = src.substring(initialStart, initialEnd);
        if (sliceAtCoords === initialFormulaMarkdown || sliceAtCoords.trim() === initialFormulaMarkdown.trim()) {
          cell.model.sharedModel.setSource(src.substring(0, initialStart) + formatted + src.substring(initialEnd));
          replaced = true;
        }
      }
    }

    // Priorität 2: Vorkommen der Ausgangsformel am nächsten zur ursprünglichen Startposition
    if (!replaced && initialFormulaMarkdown) {
      const target = initialFormulaMarkdown.trim();
      let bestIdx = -1;
      let minDistance = Infinity;
      let searchPos = 0;

      while ((searchPos = src.indexOf(target, searchPos)) !== -1) {
        const dist = initialStart !== undefined ? Math.abs(searchPos - initialStart) : 0;
        if (dist < minDistance) {
          minDistance = dist;
          bestIdx = searchPos;
        }
        searchPos += target.length;
      }

      if (bestIdx !== -1) {
        cell.model.sharedModel.setSource(src.substring(0, bestIdx) + formatted + src.substring(bestIdx + target.length));
        replaced = true;
      }
    }

    // Priorität 3: Fallback über allFormulas
    if (!replaced) {
      const allFormulas = extractAllFormulasFromMarkdown(src);
      const matched = allFormulas.find(f => f.latex === originalLatex || f.latex.replace(/\s+/g, ' ') === originalLatex.replace(/\s+/g, ' '));
      if (matched && matched.start >= 0 && matched.end > matched.start) {
        cell.model.sharedModel.setSource(src.substring(0, matched.start) + formatted + src.substring(matched.end));
        replaced = true;
      } else {
        insertAroundSelection(cell, '', '', formatted);
      }
    }
    showNemeToast('Formel aktualisiert!');
    close();
  });

  renderMathPreview();
  setTimeout(() => {
    texInput.focus();
    texInput.select();
  }, 50);
}

/**
 * Anreichern der gerenderten Markdown-Zellen mit In-Place Editoren
 */
function transformRenderedMarkdown(notebookPanel: NotebookPanel): void {
  notebookPanel.content.widgets.forEach(widget => {
    const cell = widget as MarkdownCell;
    if (!cell || (cell.model?.type !== 'markdown' && !(cell as any).cellType && !cell.node.classList.contains('jp-MarkdownCell'))) {
      return;
    }

    const renderedArea = cell.node.querySelector('.jp-RenderedMarkdown') || cell.node.querySelector('.jp-MarkdownOutput');
    if (!renderedArea) return;

    const src = cell.model.sharedModel.getSource();
    const allFormulas = extractAllFormulasFromMarkdown(src);

    // 1. Tabellen mit "Tabelle bearbeiten"-Button versehen
    renderedArea.querySelectorAll('table:not(.obsidian-processed)').forEach(table => {
      table.classList.add('obsidian-processed');
      const wrapper = document.createElement('div');
      wrapper.className = 'obsidian-table-wrapper';
      table.parentNode?.insertBefore(wrapper, table);
      wrapper.appendChild(table);

      const editBtn = document.createElement('button');
      editBtn.className = 'obsidian-table-edit-btn';
      editBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>
        <span>Tabelle bearbeiten</span>
      `;
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tablesInSrc = extractAllMarkdownTables(src);
        openTableEditorModal(cell, tablesInSrc[0]);
      });
      wrapper.appendChild(editBtn);
    });

    // 2. Alle Formeln in Dokumentenreihenfolge identifizieren und lückenlos mit Editoren versehen
    const mathSelectors = [
      'mjx-container',
      '.katex-display',
      '.katex',
      'div.jp-RenderedMath',
      'span.jp-RenderedMath',
      'div.MathJax_Display',
      '.MathJax'
    ];

    const rawMathElements = Array.from(renderedArea.querySelectorAll<HTMLElement>(mathSelectors.join(', ')));
    // Nur Top-Level Math-Elemente (keine verschachtelten Sub-Knoten) und noch nicht verarbeitete
    const mathElements = rawMathElements.filter(el => {
      if (el.classList.contains('obsidian-processed') || el.closest('.obsidian-math-block-wrapper') || el.closest('.obsidian-inline-math-wrapper')) {
        return false;
      }
      return !rawMathElements.some(other => other !== el && other.contains(el));
    });

    mathElements.forEach((mathEl, mIdx) => {
      mathEl.classList.add('obsidian-processed');

      // TeX über MathJax/KaTeX Annotation ermitteln
      const annotation = mathEl.querySelector('annotation[encoding="application/x-tex"]') || mathEl.querySelector('annotation');
      const annoText = annotation?.textContent?.trim();

      // Exakte Quellformel aus allFormulas ermitteln
      let targetFormula: ExtractedFormula | undefined;
      if (annoText) {
        targetFormula = allFormulas.find(f => f.latex === annoText || f.latex.replace(/\s+/g, ' ') === annoText.replace(/\s+/g, ' '));
      }

      // Falls keine Annotation vorhanden ist, nutze 1-zu-1 Zuordnung in Dokumentenreihenfolge
      if (!targetFormula && mIdx < allFormulas.length) {
        targetFormula = allFormulas[mIdx];
      }

      // Bestimme ob Block oder Inline:
      // Priorität 1: targetFormula.isBlock (aus dem Markdown-Quellcode)
      // Priorität 2: DOM-Display-Attribute
      const isBlock = targetFormula !== undefined ? targetFormula.isBlock : (
        mathEl.getAttribute('display') === 'true' ||
        mathEl.classList.contains('katex-display') ||
        mathEl.tagName.toLowerCase() === 'div' ||
        mathEl.getAttribute('data-display') === 'true'
      );

      const exactLatex = targetFormula ? targetFormula.latex : (annoText || mathEl.textContent?.trim() || '');
      const exactRaw = targetFormula ? targetFormula.raw : (isBlock ? `$$\\n${exactLatex}\\n$$` : `$${exactLatex}$`);
      const exactStart = targetFormula ? targetFormula.start : undefined;
      const exactEnd = targetFormula ? targetFormula.end : undefined;

      if (isBlock) {
        // Block-Formel
        const wrapper = document.createElement('div');
        wrapper.className = 'obsidian-math-block-wrapper';
        wrapper.title = exactLatex ? `Formel bearbeiten ($$${exactLatex}$$)` : 'Formel bearbeiten';
        mathEl.parentNode?.insertBefore(wrapper, mathEl);
        wrapper.appendChild(mathEl);

        const editBtn = document.createElement('button');
        editBtn.className = 'obsidian-math-edit-btn';
        editBtn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.2"><path d="M18 7V4H6l6 8-6 8h12v-3"/></svg>
          <span>Formel bearbeiten</span>
        `;

        const openHandler = (e: Event) => {
          e.stopPropagation();
          openMathEditorModal(cell, exactRaw, exactLatex, true, exactStart, exactEnd);
        };

        editBtn.addEventListener('click', openHandler);
        wrapper.addEventListener('click', openHandler);
        wrapper.appendChild(editBtn);
      } else {
        // Inline-Formel
        const wrapper = document.createElement('span');
        wrapper.className = 'obsidian-inline-math-wrapper';
        wrapper.title = exactLatex ? `Formel bearbeiten ($${exactLatex}$)` : 'Formel bearbeiten';
        mathEl.parentNode?.insertBefore(wrapper, mathEl);
        wrapper.appendChild(mathEl);

        const editBadge = document.createElement('span');
        editBadge.className = 'obsidian-inline-edit-btn';
        editBadge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.2"><path d="M18 7V4H6l6 8-6 8h12v-3"/></svg>`;
        wrapper.appendChild(editBadge);

        wrapper.addEventListener('click', (e) => {
          e.stopPropagation();
          openMathEditorModal(cell, exactRaw, exactLatex, false, exactStart, exactEnd);
        });
      }
    });

    // 3. NeME Callouts stylen
    renderedArea.querySelectorAll('blockquote:not(.obsidian-callout)').forEach(bq => {
      const p = bq.querySelector('p');
      if (!p) return;
      const match = p.innerHTML.match(/^\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT|INFO|DANGER|INSIGHT|EQUATION)\](.*)/i);
      if (match) {
        const type = match[1].toUpperCase();
        const title = match[2].trim() || type;
        bq.classList.add('obsidian-callout', `obsidian-callout-${type.toLowerCase()}`);
        p.innerHTML = `<div class="obsidian-callout-header"><span class="obsidian-callout-badge">${type}</span> <strong>${title}</strong></div>` + p.innerHTML.replace(/^\[!.*?\]/, '');
      }
    });

    // 4. Checkbox-Listen in gerenderten Markdown-Zellen interaktiv schalten
    const checkboxes = Array.from(renderedArea.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    checkboxes.forEach((cb, cbIdx) => {
      cb.disabled = false;
      cb.removeAttribute('disabled');
      cb.style.cursor = 'pointer';
      cb.style.pointerEvents = 'auto';
      cb.style.accentColor = '#f59e0b';

      const parentLi = cb.closest('li') || cb.parentElement;
      if (parentLi) {
        if (cb.checked) {
          parentLi.classList.add('obsidian-task-done');
        } else {
          parentLi.classList.remove('obsidian-task-done');
        }
      }

      if (!cb.classList.contains('obsidian-processed')) {
        cb.classList.add('obsidian-processed');

        // Mousedown und Click stoppen, damit die Zelle nicht in den Editiermodus springt
        cb.addEventListener('mousedown', (e) => {
          e.stopPropagation();
        });
        cb.addEventListener('click', (e) => {
          e.stopPropagation();
        });
        cb.addEventListener('change', (e) => {
          e.stopPropagation();
          const currentSrc = cell.model.sharedModel.getSource();
          const updatedSrc = toggleNemeMarkdownCheckbox(currentSrc, cbIdx, cb.checked);
          if (updatedSrc !== currentSrc) {
            cell.model.sharedModel.setSource(updatedSrc);
            const pLi = cb.closest('li') || cb.parentElement;
            if (pLi) {
              if (cb.checked) {
                pLi.classList.add('obsidian-task-done');
              } else {
                pLi.classList.remove('obsidian-task-done');
              }
            }
          }
        });
      }
    });
  });
}

/**
 * =========================================================================
 * NeME Kernel Variable Inspector
 * Fragt den aktuellen Python-Kernel (IPython/Pyodide) im Hintergrund
 * lautlos ('silent: true', 'store_history: false') ab und stellt
 * die Variablen in einer strukturierten Tabelle dar.
 * =========================================================================
 */
let activeVarInspector: HTMLElement | null = null;
let autoRefreshVars = true;
let lastFetchedVariables: Array<{ name: string; type: string; shape: string; value: string }> = [];

function attachVariableInspectorButton(notebookPanel: NotebookPanel): void {
  if ((notebookPanel as any)._varInspectorBtnAttached) return;
  (notebookPanel as any)._varInspectorBtnAttached = true;

  const toolbar = notebookPanel.toolbar?.node;
  const btn = document.createElement('button');
  btn.className = 'jp-ToolbarButtonComponent obsidian-toolbar-var-btn';
  btn.title = 'NeME Variablen-Inspektor (Kernel)';
  btn.innerHTML = `
    <span class="jp-ToolbarButtonComponent-icon">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
        <line x1="12" y1="22.08" x2="12" y2="12"/>
      </svg>
    </span>
    <span class="jp-ToolbarButtonComponent-label" style="font-size: 11px; font-weight: 600; margin-left: 3px;">Variablen</span>
  `;

  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleVariableInspector(notebookPanel);
  };

  if (toolbar) {
    toolbar.appendChild(btn);
  }
}

function toggleVariableInspector(notebookPanel: NotebookPanel): void {
  const existing = document.getElementById('obsidian-variable-inspector-panel');
  if (existing) {
    existing.remove();
    activeVarInspector = null;
    return;
  }

  const panel = document.createElement('div');
  panel.id = 'obsidian-variable-inspector-panel';
  panel.className = 'obsidian-variable-panel';
  panel.innerHTML = `
    <div class="obsidian-var-header">
      <div class="obsidian-var-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
        <span>Kernel Variablen-Explorer</span>
        <span id="obsidian-var-count" class="obsidian-var-badge">0</span>
      </div>
      <div class="obsidian-var-actions">
        <button id="obsidian-var-refresh-btn" class="obsidian-var-icon-btn" title="Aktualisieren">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        </button>
        <button id="obsidian-var-close-btn" class="obsidian-var-icon-btn" title="Schließen">&times;</button>
      </div>
    </div>
    <div class="obsidian-var-search-bar">
      <input type="text" id="obsidian-var-filter" placeholder="Variable filtern..." />
    </div>
    <div class="obsidian-var-body" id="obsidian-var-body">
      <div class="obsidian-var-loading">Lese Kernel-Variablen...</div>
    </div>
    <div class="obsidian-var-footer">
      <label class="obsidian-var-auto-label">
        <input type="checkbox" id="obsidian-var-autorefresh" ${autoRefreshVars ? 'checked' : ''} />
        Auto-Refresh
      </label>
      <span class="obsidian-var-status" id="obsidian-var-status">Bereit</span>
    </div>
  `;

  document.body.appendChild(panel);
  activeVarInspector = panel;

  panel.querySelector('#obsidian-var-close-btn')!.addEventListener('click', () => {
    panel.remove();
    activeVarInspector = null;
  });

  const refreshBtn = panel.querySelector('#obsidian-var-refresh-btn')!;
  refreshBtn.addEventListener('click', () => {
    refreshKernelVariables(notebookPanel, true);
  });

  const filterInput = panel.querySelector('#obsidian-var-filter') as HTMLInputElement;
  filterInput.addEventListener('input', () => {
    applyVariableFilter(filterInput.value);
  });

  const autoCheckbox = panel.querySelector('#obsidian-var-autorefresh') as HTMLInputElement;
  autoCheckbox.addEventListener('change', () => {
    autoRefreshVars = autoCheckbox.checked;
  });

  refreshKernelVariables(notebookPanel, true);
}

function updateVariableInspectorIfOpen(notebookPanel: NotebookPanel): void {
  if (activeVarInspector && autoRefreshVars) {
    refreshKernelVariables(notebookPanel, false);
  }
}

function refreshKernelVariables(notebookPanel: NotebookPanel, showSpinner = false): void {
  const panel = document.getElementById('obsidian-variable-inspector-panel');
  if (!panel) return;

  const statusEl = panel.querySelector('#obsidian-var-status');
  const bodyEl = panel.querySelector('#obsidian-var-body');
  if (statusEl) statusEl.textContent = 'Kernel wird abgefragt...';
  if (showSpinner && bodyEl && lastFetchedVariables.length === 0) {
    bodyEl.innerHTML = '<div class="obsidian-var-loading">Lese Kernel-Variablen...</div>';
  }

  const kernel = (notebookPanel.sessionContext as any)?.session?.kernel;
  if (!kernel) {
    if (statusEl) statusEl.textContent = 'Kein Kernel aktiv';
    if (bodyEl) {
      bodyEl.innerHTML = '<div class="obsidian-var-empty">Kein aktiver Kernel verbunden.<br/><small>Bitte starten Sie eine Kernel-Sitzung.</small></div>';
    }
    return;
  }

  const inspectCode = `
try:
    import json
    def _neme_get_vars():
        _res = []
        _skip = {'In', 'Out', 'get_ipython', 'exit', 'quit', 'open', '_', '__', '___', '_i', '_ii', '_iii', '_oh', '_dh', '_ih', '_neme_get_vars'}
        for _k, _v in list(globals().items()):
            if _k.startswith('_') or _k in _skip:
                continue
            _t = type(_v).__name__
            if _t in ('module', 'function', 'builtin_function_or_method', 'type'):
                continue
            _s = ''
            if hasattr(_v, 'shape'):
                try: _s = str(_v.shape)
                except: _s = ''
            elif hasattr(_v, '__len__'):
                try: _s = f"{len(_v)} Items" if not isinstance(_v, (str, bytes)) else f"{len(_v)} Zeichen"
                except: _s = ''
            try:
                if hasattr(_v, 'columns'):
                    _val = f"Columns: {list(_v.columns)[:4]}"
                elif isinstance(_v, (list, tuple, set)):
                    _val = str(_v)[:50] + ('...' if len(str(_v)) > 50 else '')
                elif isinstance(_v, dict):
                    _val = f"Keys: {list(_v.keys())[:3]}" + ('...' if len(_v) > 3 else '')
                else:
                    _val = str(_v)[:60] + ('...' if len(str(_v)) > 60 else '')
            except:
                _val = '<Preview unavailable>'
            _res.append({'name': str(_k), 'type': str(_t), 'shape': str(_s), 'value': str(_val)})
        return _res
    print('__NeME_VARS_JSON__' + json.dumps(_neme_get_vars()) + '__NeME_VARS_END__')
except Exception as _e:
    print('__NeME_VARS_JSON__[]__NeME_VARS_END__')
`;

  try {
    const future = kernel.requestExecute({
      code: inspectCode,
      silent: true,
      store_history: false
    });

    future.onIOPub = (msg: any) => {
      if (msg.header.msg_type === 'stream') {
        const text = msg.content?.text || '';
        if (text.includes('__NeME_VARS_JSON__')) {
          const match = text.match(/__NeME_VARS_JSON__(.*?)__NeME_VARS_END__/s);
          if (match && match[1]) {
            try {
              const vars = JSON.parse(match[1]);
              lastFetchedVariables = vars;
              renderVariableTable(vars);
              if (statusEl) statusEl.textContent = 'Aktualisiert ' + new Date().toLocaleTimeString();
            } catch (_err) {
              if (statusEl) statusEl.textContent = 'Fehler beim Parsen';
            }
          }
        }
      }
    };
  } catch (_err) {
    if (statusEl) statusEl.textContent = 'Fehler bei Kernel-Abfrage';
  }
}

function renderVariableTable(vars: Array<{ name: string; type: string; shape: string; value: string }>): void {
  const panel = document.getElementById('obsidian-variable-inspector-panel');
  if (!panel) return;

  const countEl = panel.querySelector('#obsidian-var-count');
  if (countEl) countEl.textContent = String(vars.length);

  const bodyEl = panel.querySelector('#obsidian-var-body');
  if (!bodyEl) return;

  if (vars.length === 0) {
    bodyEl.innerHTML = '<div class="obsidian-var-empty">Keine benutzerdefinierten Variablen im Kernel gefunden.<br/><small>Führen Sie eine Zelle mit Zuweisungen wie z.B. <code>x = 42</code> oder <code>df = ...</code> aus.</small></div>';
    return;
  }

  let html = `
    <table class="obsidian-var-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Typ</th>
          <th>Shape / Größe</th>
          <th>Wert / Vorschau</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const v of vars) {
    let typeClass = 'obsidian-type-generic';
    if (v.type === 'DataFrame' || v.type === 'Series') typeClass = 'obsidian-type-df';
    else if (v.type === 'ndarray') typeClass = 'obsidian-type-array';
    else if (v.type === 'int' || v.type === 'float') typeClass = 'obsidian-type-num';
    else if (v.type === 'str') typeClass = 'obsidian-type-str';
    else if (v.type === 'list' || v.type === 'dict' || v.type === 'tuple') typeClass = 'obsidian-type-collection';

    html += `
      <tr class="obsidian-var-row" data-name="${v.name.toLowerCase()}">
        <td class="obsidian-var-name"><code>${escapeVarHtml(v.name)}</code></td>
        <td><span class="obsidian-type-pill ${typeClass}">${escapeVarHtml(v.type)}</span></td>
        <td class="obsidian-var-shape">${escapeVarHtml(v.shape || '–')}</td>
        <td class="obsidian-var-val" title="${escapeVarHtml(v.value)}">${escapeVarHtml(v.value)}</td>
      </tr>
    `;
  }

  html += '</tbody></table>';
  bodyEl.innerHTML = html;
}

function applyVariableFilter(query: string): void {
  const q = query.toLowerCase().trim();
  const rows = document.querySelectorAll('.obsidian-var-row');
  rows.forEach(r => {
    const name = r.getAttribute('data-name') || '';
    if (!q || name.includes(q)) {
      (r as HTMLElement).style.display = '';
    } else {
      (r as HTMLElement).style.display = 'none';
    }
  });
}

function escapeVarHtml(str: string): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const plugins: JupyterFrontEndPlugin<any>[] = [extension];
export default plugins;
export { extension, plugins };