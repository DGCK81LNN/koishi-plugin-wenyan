import type {} from "@koishijs/plugin-help"
import { compile as compileWenyan } from "@wenyan/core"
import type { MacroDefinition, RomanizeSystem } from "@wenyan/core/types"
import byline from "byline"
import { execaNode } from "execa"
import { Context, Schema, h } from "koishi"
import { stat } from "node:fs/promises"
import path from "node:path"
import { inspect } from "node:util"
import { minify } from "terser"
import { expandMacros } from "./macro"

export const name = "wenyan"

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

const WYG_MODULES_DIR = "藏書樓"

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
        item.every(subitem => typeof subitem === "string"),
    )
  )
}

// Adapted from https://github.com/wenyan-lang/wenyan/blob/97f0a4b8c5a815467c5c2cac08215d722efde208/src/converts/hanzi2num.ts
// and https://github.com/wenyan-lang/wenyan/blob/97f0a4b8c5a815467c5c2cac08215d722efde208/src/execute.ts#L12-L22
const hanzinizeOutputHelper = `const NEG_WORD="負";const INF_WORD="無限大數";const NAN_WORD="不可算數";const DECIMAL_WORD={readout:"又"};const DIGIT_WORDS={readout:{0:"零",1:"一",2:"二",3:"三",4:"四",5:"五",6:"六",7:"七",8:"八",9:"九"}};const MULT_WORDS={readout:[{str:"極",exp:48},{str:"載",exp:44},{str:"正",exp:40},{str:"澗",exp:36},{str:"溝",exp:32},{str:"穰",exp:28},{str:"秭",exp:24},{str:"垓",exp:20},{str:"京",exp:16},{str:"兆",exp:12},{str:"億",exp:8},{str:"萬",exp:4},{str:"千",exp:3},{str:"百",exp:2},{str:"十",exp:1},{str:"",exp:0},{str:"分",exp:-1},{str:"釐",exp:-2},{str:"毫",exp:-3},{str:"絲",exp:-4},{str:"忽",exp:-5},{str:"微",exp:-6},{str:"纖",exp:-7},{str:"沙",exp:-8},{str:"塵",exp:-9},{str:"埃",exp:-10},{str:"渺",exp:-11},{str:"漠",exp:-12}]};function num2hanzi(n){if(!Number.isFinite(n)){if(n===Infinity){return INF_WORD}else if(n===-Infinity){return NEG_WORD+INF_WORD}else{return NAN_WORD}}function parseNumStr(str){function myIndexOf(str,val){const idx=str.indexOf(val);return idx<0?str.length:idx}const sign=str.charAt(0)==="-"?-1:1;const digitIndex="+-".includes(str.charAt(0))?1:0;const expIndex=myIndexOf(str,"e");const scientificExp=expIndex===str.length?0:Number(str.substring(expIndex+1));const decimalIndex=myIndexOf(str.substring(0,expIndex),".");const intStr=str.substring(digitIndex,decimalIndex);const intDigits=intStr.split("").reverse();const fracStr=str.substring(Math.min(decimalIndex+1,expIndex),expIndex);const fracDigits=fracStr.split("").reverse();return{sign:sign,exp:scientificExp-fracDigits.length,digits:fracDigits.concat(intDigits)}}const chineseFormat="readout";const multWords=MULT_WORDS[chineseFormat];const digitWords=DIGIT_WORDS[chineseFormat];const decimalWord=DECIMAL_WORD[chineseFormat];let numStr=n.toString();let result=parseNumStr(numStr);let signStr=result.sign<0?NEG_WORD:"";let rend=result.digits.findIndex(x=>x!=="0");if(rend<0){return signStr+digitWords["0"]}let rbegin=result.digits.length;while(result.digits[rbegin-1]==="0"){--rbegin}const minMultExp=multWords[multWords.length-1].exp;if(result.exp+rend<minMultExp){numStr=n.toFixed(-minMultExp);result=parseNumStr(numStr);signStr=result.sign<0?NEG_WORD:"";rend=result.digits.findIndex(x=>x!=="0");if(rend<0){return signStr+digitWords["0"]}rbegin=result.digits.length;while(result.digits[rbegin-1]==="0"){--rbegin}}let str=signStr;let pendingZero=false;let i=rbegin;const intToReadout=function(expBias=0){let hasOutput=false;while(i!==rend){const mult=multWords.find(x=>x.exp+expBias<=result.exp+(i-1));if(mult===undefined||mult.exp<0){break}else if(mult.exp>0){if(intToReadout(expBias+mult.exp)){pendingZero=false;str+=mult.str;hasOutput=true}}else if(mult.exp===0){if(result.digits[i-1]!=="0"){if(pendingZero){str+=digitWords["0"];pendingZero=false}str+=digitWords[result.digits[i-1]];hasOutput=true}else{pendingZero=true}--i;break}}return hasOutput};const fracToReadout=function(){while(i!==rend){const mult=multWords.find(x=>x.exp<=result.exp+(i-1));if(mult===undefined){break}if(intToReadout(mult.exp)){str+=mult.str;pendingZero=false}}};const hasInt=intToReadout();pendingZero=false;if(i!==rend){if(hasInt){str+=decimalWord}while(i!==rend&&result.digits[i-1]==="0"){--i}fracToReadout()}return str}function bool2hanzi(b){return b?"陽":"陰"}function hanzinizeOuput(value){if(typeof value=="number"){return num2hanzi(value)}else if(typeof value=="boolean"){return bool2hanzi(value)}else if(Array.isArray(value)){return value.map(i=>hanzinizeOuput(i)).join("。")}else{return value}}const output=console.log;console.log=(...args)=>output(...args.map(hanzinizeOuput))`

export async function apply(ctx: Context, config: Config) {
  ctx.i18n.define("zh", require("./locales/zh"))

  async function requireWygPackages(packages: string[], cwd: string) {
    const packagesNeeded = []
    await Promise.all(
      packages.map(async pkg => {
        ;(await stat(path.resolve(WYG_MODULES_DIR, pkg, "序.wy")).then(
          s => s.isFile(),
          () => false,
        )) || packagesNeeded.push(pkg)
      }),
    )

    if (packagesNeeded.length) {
      const wygCli = path.resolve(path.dirname(require.resolve("@wenyan/wyg")), "cli.js")
      const args = ["install", ...packagesNeeded]
      ctx.logger.info("wyg", ...args)
      const child = execaNode(wygCli, args, {
        cwd,
        all: true,
        reject: false,
      })
      byline(child.all).on("data", (line: Buffer) => {
        ctx.logger.info(line.toString())
      })
      let killing = false
      const disposeKiller = ctx.once("dispose", () => {
        killing = true
        ctx.logger.info("Killing wyg installation")
        child.kill()
      })
      child.on("exit", () => {
        if (killing) return
        ctx.logger.info("wyg install exited")
        disposeKiller()
      })
    }
  }

  async function glotJavascript(code: string, stdin = "") {
    const { data } = await ctx.http.post(
      "https://glot.io/api/mux",
      {
        action: "run",
        data: {
          image: "glot/javascript:latest",
          payload: {
            runInstructions: {
              buildCommands: [],
              runCommand: "node main.js",
            },
            files: [{ name: "main.js", content: code }],
            stdin,
          },
        },
      },
      { responseType: "json" },
    )
    const parts: string[] = [data.stdout, data.stderr, data.error].filter(Boolean)
    if (parts.length)
      return parts.reduce((res, part) => res.replace(/\n$/, "") + "\n" + part)
  }

  ctx.on("ready", () => {
    requireWygPackages(config.wygPackages, ctx.baseDir).catch(err => {
      ctx.logger.error(err)
    })
  })

  ctx
    .command("wenyan <code:rawtext>", { strictOptions: true })
    .option("compile", "-c")
    .option("macro", "<extract|expand>", { hidden: true })
    .option("macro", "-M, --extract-macro", { value: "extract" })
    .option("macro", "-e, --expand-macro", { value: "expand" })
    .option("roman", "<pinyin|unicode|baxter>")
    .option("strict", "")
    .option("minify", "-m")
    .option("outputHanzi", "", { hidden: true })
    .option("outputHanzi", "-H, --no-output-hanzi", { value: false })
    .option("stdin", "-s <text>")
    .action(async ({ options, session, root }, code) => {
      if (options.roman && !isValidRomanizeSystem(options.roman)) {
        await session.send(session.i18n(".invalid-romanize-method"))
        return
      }
      let compiled = ""
      let compileError = ""
      let macros: MacroDefinition[]
      try {
        compiled = compileWenyan(code, {
          romanizeIdentifiers: options.roman || "none",
          strict: !!options.strict,
          importPaths: [path.resolve(ctx.baseDir, WYG_MODULES_DIR)],
          logCallback: msg => {
            if (isMacroDefinitionList(msg)) macros ??= msg
          },
          errorCallback: msg => {
            compileError += String(msg) + "\n"
          },
        })
      } catch (err) {
        compileError = compileError.trim() || String(err)
        await session.send(session.i18n(".compile-error", [compileError]))
        return
      }
      if (options.macro) {
        if (!macros || !macros.length) {
          await session.send(session.i18n(".no-macro"))
          return
        }
        if (options.macro === "extract")
          return macros
            .map(([from, to]) => `${inspect(new RegExp(from))} → ${inspect(to)}`)
            .join("\n")
        if (options.macro === "expand") return h.text(expandMacros(code, macros))
        await session.send(session.i18n(".invalid-macro-action"))
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
          await session.send(session.i18n(".minify-error", [String(err)]))
          return
        }
      if (options.compile) return h.text(compiled)

      if (options.outputHanzi !== false)
        compiled = `(()=>{${hanzinizeOutputHelper}})();\n${compiled}`
      const result = await glotJavascript(compiled, options.stdin)
      if (result) return h.text(result)
      if (root) await session.send(session.i18n(".no-output"))
    })
}
