// DELIBERATELY BROKEN. Never linted by `pnpm lint` (ignored via **/*.fixture.ts)
// and never typechecked (excluded in tsconfig.test.json). It exists only as
// input to tests/purity.test.ts, which lints this text programmatically.

import React from 'react';
import type { ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import { readFileSync } from 'node:fs';
import { join } from 'path';

export const violations = [React, useRouter, readFileSync, join];
export type AlsoAViolation = ComponentType;
