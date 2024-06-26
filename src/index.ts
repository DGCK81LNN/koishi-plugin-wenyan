import type {} from "@koishijs/plugin-help"
import { compile as compileWenyan } from "@wenyan/core"
import type { MacroDefinition, RomanizeSystem } from "@wenyan/core/types"
import byline from "byline"
import { Context, Schema, h } from "koishi"
import { stat } from "node:fs/promises"
import path from "node:path"
import { inspect } from "node:util"
import { minify } from "terser"
import { expandMacros } from "./macro"

export const name = "wenyan"
//export const inject = ["worker"]

export interface Config {
  wygPackages: string[]
}

export const Config: Schema<Config> = Schema.object({
  wygPackages: Schema.array(String)
    .role("table")
    .description("需要安装的 [wyg](https://wyg.wy-lang.org) 包（必须填写中文名）列表。")
    .default([
      "交互秘術",
      "刻漏",
      "器經",
      "子曰",
      "干支",
      "柯裡化法",
      "異步秘術",
      "符經",
      "简体秘术",
      "简化方言",
      "腳本秘術",
      "解析整數",
      "造類秘術",
      "閱文秘術",
    ]),
})

function isValidRomanizeSystem(method: string): method is RomanizeSystem {
  return ["none", "pinyin", "unicode", "baxter"].includes(method)
}

function isMacroDefinitionList(value: unknown): value is MacroDefinition[] {
  return (
    Array.isArray(value) &&
    value.length &&
    value.every(
      item =>
        Array.isArray(item) &&
        item.length === 2 &&
        item.every(subitem => typeof subitem === "string")
    )
  )
}

export async function apply(ctx: Context, config: Config) {
  const logger = ctx.logger(name)
  ctx.i18n.define("zh", require("./locales/zh"))

  async function requireWygPackages(packages: string[], cwd: string) {
    const packagesNeeded = []
    await Promise.all(
      packages.map(async pkg => {
        ;(await stat(path.resolve("藏書樓", pkg, "序.wy")).then(
          s => s.isFile(),
          () => false
        )) || packagesNeeded.push(pkg)
      })
    )

    if (packagesNeeded.length) {
      const { execaNode } = await import("execa")
      const { default: whichPMRuns } = await import("which-pm-runs")

      const { name: pm } = whichPMRuns()
      if (!pm) throw new Error("Package manager not supported")

      const wygCli = path.resolve(path.dirname(require.resolve("@wenyan/wyg")), "cli.js")
      const args = ["install", ...packagesNeeded]
      logger.info("wyg", ...args)
      const child = execaNode(wygCli, args, {
        cwd,
        all: true,
        reject: false,
      })
      byline(child.all).on("data", (line: Buffer) => {
        logger.info(line.toString())
      })
      let killing = false
      const disposeKiller = ctx.once("dispose", () => {
        killing = true
        logger.info("Killing wyg installation")
        child.kill()
      })
      child.on("exit", () => {
        if (killing) return
        logger.info("wyg install exited")
        disposeKiller()
      })
    }
  }

  ctx.on("ready", () => {
    requireWygPackages(config.wygPackages, ctx.baseDir).catch(err => {
      logger.error(err)
    })
  })

  ctx
    .command("wenyan <code:rawtext>", {
      checkUnknown: true,
      showWarning: true,
    })
    .option("compile", "-c", { fallback: false })
    .option("macro", "<extract|expand>")
    .option("macro", "-M", { value: "extract", hidden: true })
    .option("macro", "-e", { value: "expand", hidden: true })
    .option("roman", "<pinyin|unicode|baxter>", { fallback: "none" })
    .option("strict", "", { fallback: false })
    .option("minify", "-m", { fallback: false })
    //.option("outputHanzi", "", { fallback: true })
    //.option("outputHanzi", "-H", { value: false, hidden: true })
    //.option("stdin", "-s <text:rawtext>")
    .action(async ({ options, session }, code) => {
      if (!isValidRomanizeSystem(options.roman)) {
        await session.send(session.text(".invalid-romanize-method"))
        return
      }
      let compiled = ""
      let compileError = ""
      let macros: MacroDefinition[]
      try {
        compiled = compileWenyan(code, {
          romanizeIdentifiers: options.roman,
          strict: options.strict,
          importPaths: [path.resolve(ctx.baseDir, "藏書樓")],
          logCallback: msg => {
            if (isMacroDefinitionList(msg)) macros ??= msg
          },
          errorCallback: msg => {
            compileError += String(msg) + "\n"
          },
        })
      } catch (err) {
        compileError = compileError.trim() || String(err)
        await session.send(session.text(".compile-error", [h.escape(compileError)]))
        return
      }
      if (options.macro) {
        if (!macros || !macros.length) {
          await session.send(session.text(".no-macro"))
          return
        }
        if (options.macro === "extract")
          return macros
            .map(([from, to]) => `${inspect(new RegExp(from))} → ${inspect(to)}`)
            .join("\n")
        if (options.macro === "expand") return h.escape(expandMacros(code, macros))
        await session.send(session.text(".invalid-macro-action"))
        return
      }
      if (options.minify)
        try {
          compiled = (
            await minify(compiled, {
              toplevel: true,
              compress: {
                ecma: 2020,
              },
              mangle: null,
              format: {
                comments: false,
              },
            })
          ).code
        } catch (err) {
          await session.send(session.text(".minify-error", [h.escape(String(err))]))
          return
        }
      if (options.compile) return h.escape(compiled)

      await session.send("Not Implemented")
      return
    })
}
