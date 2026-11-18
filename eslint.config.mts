import type { ESLint, Rule } from 'eslint';
import type { Node as EstreeNode, ObjectExpression } from 'estree';
import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

type FnNode = Extract<EstreeNode, { type: 'FunctionExpression' | 'ArrowFunctionExpression' }>;

function walkAst(node: EstreeNode | null | undefined, visit: (n: EstreeNode) => void): void {
	if (!node || typeof node !== 'object') return;
	visit(node);
	for (const [key, value] of Object.entries(node)) {
		if (key === 'parent') continue;
		if (Array.isArray(value)) {
			for (const item of value) {
				if (item && typeof item === 'object' && 'type' in item) {
					walkAst(item as EstreeNode, visit);
				}
			}
		} else if (value && typeof value === 'object' && 'type' in value) {
			walkAst(value as EstreeNode, visit);
		}
	}
}

function getPropertyKeyName(prop: ObjectExpression['properties'][number]): string | null {
	if (prop.type !== 'Property') return null;
	if (prop.key.type === 'Identifier') return prop.key.name;
	if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') return prop.key.value;
	return null;
}

const whiteboardPlugin: ESLint.Plugin = {
	rules: {
		'require-pinned-edge-sides': {
			meta: {
				type: 'problem',
				docs: { description: 'Require fromSide and toSide on WhiteboardEdge object literals so connection points stay pinned when cards move.' },
				messages: {
					missingSide: 'WhiteboardEdge literal must explicitly specify both `fromSide` and `toSide` so connection points do not jump when moving cards.',
				},
				schema: [],
			},
			create(context: Rule.RuleContext): Rule.RuleListener {
				return {
					ObjectExpression(node: ObjectExpression) {
						const keys = new Set(node.properties.map(getPropertyKeyName).filter((k): k is string => k !== null));
						if (keys.has('fromNodeId') && keys.has('toNodeId') && (!keys.has('fromSide') || !keys.has('toSide'))) {
							context.report({ node, messageId: 'missingSide' });
						}
					},
				};
			},
		},
		'require-prevent-default-on-interaction': {
			meta: {
				type: 'problem',
				docs: { description: 'Require preventDefault() in handlers that start a canvas drag/resize/connect interaction.' },
				messages: {
					missingPreventDefault: 'Handler that starts `this.interaction` must call `preventDefault()` to avoid native text selection hijacking mouseup.',
				},
				schema: [],
			},
			create(context: Rule.RuleContext): Rule.RuleListener {
				const checkFn = (fn: FnNode) => {
					let startsInteraction = false;
					let callsPreventDefault = false;
					walkAst(fn.body, (n) => {
						if (
							n.type === 'AssignmentExpression'
							&& n.left.type === 'MemberExpression'
							&& n.left.object.type === 'ThisExpression'
							&& n.left.property.type === 'Identifier'
							&& n.left.property.name === 'interaction'
							&& n.right.type === 'ObjectExpression'
						) {
							startsInteraction = true;
						}
						if (
							n.type === 'CallExpression'
							&& n.callee.type === 'MemberExpression'
							&& n.callee.property.type === 'Identifier'
							&& n.callee.property.name === 'preventDefault'
						) {
							callsPreventDefault = true;
						}
					});
					if (startsInteraction && !callsPreventDefault) {
						context.report({ node: fn, messageId: 'missingPreventDefault' });
					}
				};
				return {
					FunctionExpression: checkFn,
					ArrowFunctionExpression: checkFn,
				};
			},
		},
		'require-focus-on-selection-stop-propagation': {
			meta: {
				type: 'problem',
				docs: { description: 'Require focus() when a selection handler calls stopPropagation() so Delete/Backspace shortcuts keep working.' },
				messages: {
					missingFocus: 'Selection handler calling `stopPropagation()` must call `focus(...)` on the canvas root so keyboard shortcuts (Delete/Backspace/Escape) still work.',
				},
				schema: [],
			},
			create(context: Rule.RuleContext): Rule.RuleListener {
				const checkFn = (fn: FnNode) => {
					let stopsPropagation = false;
					let mutatesSelection = false;
					let callsFocus = false;
					walkAst(fn.body, (n) => {
						if (
							n.type === 'CallExpression'
							&& n.callee.type === 'MemberExpression'
							&& n.callee.property.type === 'Identifier'
						) {
							if (n.callee.property.name === 'stopPropagation') stopsPropagation = true;
							if (n.callee.property.name === 'focus') callsFocus = true;
						}
						if (
							n.type === 'AssignmentExpression'
							&& n.left.type === 'MemberExpression'
							&& n.left.object.type === 'ThisExpression'
							&& n.left.property.type === 'Identifier'
							&& (n.left.property.name === 'selectedEdgeId'
								|| n.left.property.name === 'selectedSectionId'
								|| n.left.property.name === 'selectedNodeIds')
						) {
							mutatesSelection = true;
						}
					});
					if (stopsPropagation && mutatesSelection && !callsFocus) {
						context.report({ node: fn, messageId: 'missingFocus' });
					}
				};
				return {
					FunctionExpression: checkFn,
					ArrowFunctionExpression: checkFn,
				};
			},
		},
		'no-space-in-svg-cls': {
			meta: {
				type: 'problem',
				docs: { description: 'Forbid space-separated strings or template literals in createSvg({ cls }) which throw InvalidCharacterError in DOMTokenList.add.' },
				messages: {
					noSpaceInSvgCls: 'Do not pass space-separated class strings or template literals to `createSvg(..., { cls })`; use a single class token and `classList.add(...)` for conditional classes.',
				},
				schema: [],
			},
			create(context: Rule.RuleContext): Rule.RuleListener {
				return {
					CallExpression(node) {
						if (
							node.callee.type !== 'MemberExpression'
							|| node.callee.property.type !== 'Identifier'
							|| node.callee.property.name !== 'createSvg'
						) {
							return;
						}
						const secondArg = node.arguments[1];
						if (!secondArg) return;
						if (secondArg.type === 'TemplateLiteral' || (secondArg.type === 'Literal' && typeof secondArg.value === 'string' && /\s/.test(secondArg.value))) {
							context.report({ node: secondArg, messageId: 'noSpaceInSvgCls' });
							return;
						}
						if (secondArg.type === 'ObjectExpression') {
							for (const prop of secondArg.properties) {
								if (getPropertyKeyName(prop) === 'cls' && prop.type === 'Property') {
									const val = prop.value;
									if (val.type === 'TemplateLiteral' || (val.type === 'Literal' && typeof val.value === 'string' && /\s/.test(val.value))) {
										context.report({ node: val, messageId: 'noSpaceInSvgCls' });
									}
								}
							}
						}
					},
				};
			},
		},
		'require-visual-sync-on-node-selection': {
			meta: {
				type: 'problem',
				docs: { description: 'Require updateSelectionVisuals(), renderNodes(), or renderAll() whenever this.selectedNodeIds is mutated.' },
				messages: {
					missingVisualSync: 'Function mutating `this.selectedNodeIds` must call `this.updateSelectionVisuals()`, `this.renderNodes()`, or `this.renderAll()` so DOM `.is-selected` classes stay in sync.',
				},
				schema: [],
			},
			create(context: Rule.RuleContext): Rule.RuleListener {
				const checkFn = (fn: FnNode) => {
					let mutatesNodeSelection = false;
					let syncsVisuals = false;
					walkAst(fn.body, (n) => {
						if (
							n.type === 'AssignmentExpression'
							&& n.left.type === 'MemberExpression'
							&& n.left.object.type === 'ThisExpression'
							&& n.left.property.type === 'Identifier'
							&& n.left.property.name === 'selectedNodeIds'
						) {
							mutatesNodeSelection = true;
						}
						if (
							n.type === 'CallExpression'
							&& n.callee.type === 'MemberExpression'
							&& n.callee.property.type === 'Identifier'
						) {
							const method = n.callee.property.name;
							if (
								(method === 'clear' || method === 'add' || method === 'delete')
								&& n.callee.object.type === 'MemberExpression'
								&& n.callee.object.object.type === 'ThisExpression'
								&& n.callee.object.property.type === 'Identifier'
								&& n.callee.object.property.name === 'selectedNodeIds'
							) {
								mutatesNodeSelection = true;
							}
							if (
								method === 'updateSelectionVisuals'
								|| method === 'renderNodes'
								|| method === 'renderAll'
							) {
								syncsVisuals = true;
							}
						}
					});
					if (mutatesNodeSelection && !syncsVisuals) {
						context.report({ node: fn, messageId: 'missingVisualSync' });
					}
				};
				return {
					FunctionExpression: checkFn,
					ArrowFunctionExpression: checkFn,
				};
			},
		},
		'require-group-bounds-for-section': {
			meta: {
				type: 'problem',
				docs: { description: 'Require computeGroupBounds(...) when creating a new section so internal edge bezier curves are enclosed inside the section.' },
				messages: {
					missingGroupBounds: 'Function adding to `this.doc.sections` must call `computeGroupBounds(...)` so both selected cards and their bezier curves stay inside the section.',
				},
				schema: [],
			},
			create(context: Rule.RuleContext): Rule.RuleListener {
				const checkFn = (fn: FnNode) => {
					let pushesSection = false;
					let callsComputeGroupBounds = false;
					walkAst(fn.body, (n) => {
						if (n.type !== 'CallExpression') return;
						if (n.callee.type === 'Identifier' && n.callee.name === 'computeGroupBounds') {
							callsComputeGroupBounds = true;
						}
						if (
							n.callee.type === 'MemberExpression'
							&& n.callee.property.type === 'Identifier'
							&& n.callee.property.name === 'push'
							&& n.callee.object.type === 'MemberExpression'
							&& n.callee.object.property.type === 'Identifier'
							&& n.callee.object.property.name === 'sections'
						) {
							pushesSection = true;
						}
					});
					if (pushesSection && !callsComputeGroupBounds) {
						context.report({ node: fn, messageId: 'missingGroupBounds' });
					}
				};
				return {
					FunctionExpression: checkFn,
					ArrowFunctionExpression: checkFn,
				};
			},
		},
		'require-collapsed-guard-on-node-body': {
			meta: {
				type: 'problem',
				docs: { description: 'Require checking node.collapsed in an if-condition inside any function that creates .hl-wb-node-body.' },
				messages: {
					missingCollapsedGuard: 'Function creating `.hl-wb-node-body` must guard body creation with an `if` check on `node.collapsed` so collapsed cards/notes do not render their body.',
				},
				schema: [],
			},
			create(context: Rule.RuleContext): Rule.RuleListener {
				const containsNodeBodyCls = (n: EstreeNode): boolean => {
					if (n.type === 'Literal' && typeof n.value === 'string' && n.value.includes('hl-wb-node-body')) {
						return true;
					}
					return false;
				};
				const checkFn = (fn: FnNode) => {
					let createsNodeBody = false;
					let checksCollapsedInIf = false;
					walkAst(fn.body, (n) => {
						if (
							n.type === 'CallExpression'
							&& n.callee.type === 'MemberExpression'
							&& n.callee.property.type === 'Identifier'
							&& (n.callee.property.name === 'createDiv' || n.callee.property.name === 'createEl')
						) {
							for (const arg of n.arguments) {
								walkAst(arg as EstreeNode, (sub) => {
									if (containsNodeBodyCls(sub)) createsNodeBody = true;
								});
							}
						}
						if (n.type === 'IfStatement') {
							walkAst(n.test, (sub) => {
								if (
									sub.type === 'MemberExpression'
									&& sub.property.type === 'Identifier'
									&& sub.property.name === 'collapsed'
								) {
									checksCollapsedInIf = true;
								}
							});
						}
					});
					if (createsNodeBody && !checksCollapsedInIf) {
						context.report({ node: fn, messageId: 'missingCollapsedGuard' });
					}
				};
				return {
					FunctionExpression: checkFn,
					ArrowFunctionExpression: checkFn,
				};
			},
		},
	},
};

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['src/whiteboard/**/*.ts'],
		plugins: {
			whiteboard: whiteboardPlugin,
		},
		rules: {
			'obsidianmd/prefer-instanceof': 'error',
			'whiteboard/require-pinned-edge-sides': 'error',
			'whiteboard/require-prevent-default-on-interaction': 'error',
			'whiteboard/require-focus-on-selection-stop-propagation': 'error',
			'whiteboard/no-space-in-svg-cls': 'error',
			'whiteboard/require-visual-sync-on-node-selection': 'error',
			'whiteboard/require-group-bounds-for-section': 'error',
			'whiteboard/require-collapsed-guard-on-node-body': 'error',
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"vitest.config.mts",
		"docs/*.js",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		// Plain CJS build-time shims (not part of the TS project)
		"src/mocks/*.cjs",
		// Ambient module shim for the untyped simple-mind-map dependency
		"src/mindmap/simple-mind-map.d.ts",
		// Node-only test shim that must define a global `window`
		"tests/setup.ts",
	]),
);
