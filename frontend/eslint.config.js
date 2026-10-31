import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
        // project: './tsconfig.json',  // 需要完整路徑設定，暫時關閉
        // tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      'react': react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // TypeScript rules - 嚴格型別檢查
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-explicit-any': 'error',  // 禁止使用 any！
      // TODO: 下面這些規則需要 parserOptions.project，暫時關閉
      // '@typescript-eslint/no-unsafe-assignment': 'error',
      // '@typescript-eslint/no-unsafe-member-access': 'error',
      // '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // React rules
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // General rules
      'no-undef': 'off',
      'no-unused-vars': 'off',

      // UI 規範（docs/design/ui-style-guide.md 第 2 節）：不要寫死 hex 色碼
      'no-restricted-syntax': ['error',
        {
          selector: 'Literal[value=/-\\[#[0-9a-fA-F]{3,8}\\]/]',
          message: '不要寫死 hex 色碼（例如 bg-[#2563eb]），改用 Tailwind 色名或語意 class。見 docs/design/ui-style-guide.md 第 2 節',
        },
        {
          selector: 'TemplateElement[value.raw=/-\\[#[0-9a-fA-F]{3,8}\\]/]',
          message: '不要寫死 hex 色碼（例如 bg-[#2563eb]），改用 Tailwind 色名或語意 class。見 docs/design/ui-style-guide.md 第 2 節',
        },
        {
          selector: 'JSXAttribute[name.name="style"] Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
          message: '不要在 style 寫死 hex 色碼，改用 Tailwind 色名或語意 class。見 docs/design/ui-style-guide.md 第 2 節',
        },
      ],
    },
  },
  {
    // 既有寫死 hex 的檔案（#1116 建立時 19 檔、66 處）。只減不增：
    // 改掉某檔的 hex 後把它從清單移除，不要再往清單加檔案。
    files: [
      'src/components/LineContactButton.tsx',
      'src/components/activities/TugOfWarGame.tsx',
      'src/components/activities/shared/PrintPdfSheet.tsx',
      'src/components/activities/shared/PronunciationScoreChart.tsx',
      'src/components/activities/tug-of-war/TeamOptions.tsx',
      'src/components/activities/tug-of-war/pixel/PixelTugStage.tsx',
      'src/components/activities/tug-of-war/pixel/RotateOverlay.tsx',
      'src/components/pricing/SubscriptionPlanCard.tsx',
      'src/components/shared/ProgramFolderView.tsx',
      'src/components/shared/ResourceFolderView.tsx',
      'src/pages/BlogListPage.tsx',
      'src/pages/Home.tsx',
      'src/pages/PricingPage.tsx',
      'src/pages/sample/TugOfWarSample.tsx',
      'src/pages/teacher/AllStudentsTab.tsx',
      'src/pages/teacher/ClassroomsTab.tsx',
      'src/pages/teacher/ResourceMaterialsTab.tsx',
      'src/pages/teacher/SystemOverviewTab.tsx',
      'src/pages/teacher/TeacherProfile.tsx',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'vite.config.ts', '.eslintrc.cjs'],
  },
];
