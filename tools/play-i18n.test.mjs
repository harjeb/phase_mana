import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { parsePoFile } from '@lingui/format-po';

const files = [
  ...readdirSync('ui/components/play').filter(f => f.endsWith('.tsx')).map(f => `ui/components/play/${f}`),
  ...readdirSync('ui/components/lobby').filter(f => f.endsWith('.tsx')).map(f => `ui/components/lobby/${f}`),
  ...['Play', 'CasualModes', 'OnlinePlay', 'Lobby', 'Limited'].map(name => `ui/views/${name}.tsx`),
  'ui/components/layout/UpdateCallout.tsx',
  ...['OnboardingGuide', 'OnboardingWelcome', 'OnboardingHurray'].map(name => `ui/components/${name}.tsx`),
  'ui/views/Settings.tsx',
  ...readdirSync('ui/components/settings').filter(f => f.endsWith('.tsx')).map(f => `ui/components/settings/${f}`),
  ...['DeckGridCard', 'DeckHubEntryCard', 'DeckCardSurface', 'DeckCardPlayButton', 'DeckLabelBadge'].map(name => `ui/components/deck/${name}.tsx`),
  ...['NewDeckChoiceDialog.tsx', 'ImportDeckTextDialog.tsx', 'useDeckTextImport.ts'].map(name => `ui/components/editor/${name}`),
];
const visibleProps = new Set(['title', 'description', 'desc', 'label', 'cta', 'placeholder', 'aria-label', 'alt', 'heading', 'body']);
// Product names and syntax examples are not translated UI prose.
const literalExceptions = new Set(['Forge', 'Manabrew', 'Ironsmith', 'localhost', 'forge', '{"label":"…","rules":{…}}', 'LEA, LEB, ARN, …', '4 Lightning Bolt\n24 Mountain\n…', '4 Lightning Bolt\n2 Counterspell\n…']);

test('play, onboarding and settings surfaces do not contain bare English JSX copy', () => {
  const failures = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node, translated = false) {
      const insideTrans = translated || (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'Trans');
      if (!insideTrans && ts.isJsxText(node) && /[A-Za-z]{2}/.test(node.text) && !literalExceptions.has(node.text.trim())) {
        failures.push(`${file}: ${node.text.trim()}`);
      }
      const reportLiteral = expression => {
        if (!expression) return;
        if ((ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) && literalExceptions.has(expression.text)) return;
        if (ts.isTemplateExpression(expression)) {
          // Test displayed template chunks, not English identifiers in ${...}.
          if ([expression.head.text, ...expression.templateSpans.map(span => span.literal.text)].some(text => /[A-Za-z]{2}/.test(text))) {
            failures.push(`${file}:${source.getLineAndCharacterOfPosition(expression.getStart(source)).line + 1}: ${expression.getText(source)}`);
          }
          expression.templateSpans.forEach(span => reportLiteral(span.expression));
        } else if ((ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) && /[A-Za-z]{2}/.test(expression.text)) {
          failures.push(`${file}:${source.getLineAndCharacterOfPosition(expression.getStart(source)).line + 1}: ${expression.getText(source)}`);
        } else if (ts.isConditionalExpression(expression)) {
          reportLiteral(expression.whenTrue);
          reportLiteral(expression.whenFalse);
        } else if (ts.isBinaryExpression(expression)) {
          // Conditions are not UI copy; only inspect displayed alternatives.
          if (expression.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) reportLiteral(expression.left);
          reportLiteral(expression.right);
        } else if (ts.isParenthesizedExpression(expression)) reportLiteral(expression.expression);
      };
      if (ts.isJsxAttribute(node) && visibleProps.has(node.name.getText(source)) && node.initializer) {
        reportLiteral(ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer);
      }
      if (!insideTrans && ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) reportLiteral(node.expression);
      if (ts.isCallExpression(node) && /^toast\.(error|success|info|warning|message)$/.test(node.expression.getText(source))) reportLiteral(node.arguments[0]);
      if (file.includes('/Onboarding') && ts.isCallExpression(node) && node.expression.getText(source) === 'setError') reportLiteral(node.arguments[0]);
      if (ts.isPropertyAssignment(node) && visibleProps.has(node.name.getText(source))) {
        // FeatureTile's TILE_SIZES uses label/desc as CSS slot names.
        let parent = node.parent;
        while (parent && !ts.isVariableDeclaration(parent)) parent = parent.parent;
        if (!(file.endsWith('/FeatureTile.tsx') && parent?.name.getText(source) === 'TILE_SIZES')) reportLiteral(node.initializer);
      }
      ts.forEachChild(node, child => visit(child, insideTrans));
    }
    visit(source);
  }
  assert.deepEqual(failures, []);
});

test('all messages extracted from audited surfaces have Simplified Chinese translations', () => {
  const catalog = parsePoFile(readFileSync('ui/i18n/locales/zh-Hans/messages.po', 'utf8'));
  const messages = catalog.items.filter(item => !item.obsolete && item.references.some(ref => files.some(file => ref.startsWith(`${file}:`))));
  assert.ok(messages.length > 50, 'expected extracted messages from the audited pages');
  const missing = messages.filter(item => !item.msgstr[0]?.trim()).map(item => item.msgid);
  assert.deepEqual(missing, []);
  for (const id of ['Drag cards sideways for a custom order, or keep every hand sorted automatically by color or mana value.', 'Play with friends', 'Choose your nickname', 'Connect to a server from the Lobby, then join a room — or create your own — to battle other players in real time.', 'Ready to play?', 'Start a match your way, or open a deck from your collection.', "Local play against the AI. Draft variants, Commander offshoots and retro rulesets that don't fit the standard formats.", 'Your Decks', 'No decks yet — build one in <0>My Decks</0>.']) {
    assert.ok(messages.some(item => item.msgid === id && /[\u3400-\u9fff]/.test(item.msgstr[0])), id);
  }
});
