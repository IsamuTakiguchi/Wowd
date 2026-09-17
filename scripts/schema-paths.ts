import { join } from 'node:path'

/**
 * ECMA-376 の XSD を置く場所。
 *
 * 生成物なのでリポジトリにはコミットしない (.gitignore 済み)。
 * npm run schema:fetch で取得する。
 */
export const SCHEMA_DIR = join(process.cwd(), 'schema', 'ooxml')

/** 取得済みかどうかの目印であり、検証に使うスキーマ本体でもある */
export const WML_XSD = join(SCHEMA_DIR, 'wml.xsd')
