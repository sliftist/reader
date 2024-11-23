import preact from "preact";
import { observer } from "./misc/observer";
import { DiskCollection } from "./storage/DiskCollection";
import { isNode, nextId } from "socket-function/src/misc";
import { PendingDisplay } from "./storage/PendingManager";
import { css } from "typesafecss";
import { createLink, URLParamStr } from "./misc/URLParam";
import { pageURL } from "./Layout";
import { deleteSessionParagraph, getSessionParagraph, getSessionParagraphs, getSessionSpeakers, setSessionParagraph, undeleteSessionParagraph } from "./chatData";
import { observable } from "./misc/mobxTyped";
import { InputLabel, InputLabelURL } from "./misc/InputLabel";
import { AIMessage, ModelUsage, Paragraph } from "../Schema";
import { aiChatBots, countTokens } from "./AIChatters";
import { formatNumber } from "socket-function/src/formatting/format";
import { Anchor } from "./misc/Anchor";
import { lazy } from "socket-function/src/caching";
import { Input } from "./misc/Input";
import { Header } from "./Header";
import { parseJSONGPTOutput } from "./aiHelpers";
import { canHaveChildren } from "socket-function/src/types";
import { pickGoodSpeaker, segmentSpeakers } from "./voiceAndSegmentation";
import { dynamicTextArea } from "./dynamicTextArea";

export const sessionURL = new URLParamStr("session");
const tokenLimitURL = new URLParamStr("tokenLimit", 1024 * 16 + "");

const maxResponseTokens = new URLParamStr("maxResponseTokens", 2024 + "");

@observer
export class SessionView extends preact.Component {
    synced = observable({
        editting: "",
        lastDelete: "",
        editLast: false,
        editLastOverride: "",
        hideSpeakerSegments: false,
    });
    input: HTMLInputElement | null = null;
    render() {
        let sessionId = sessionURL.value;

        const chatter = aiChatBots.openai4o_mini;
        let tokenLimit = Math.min(+tokenLimitURL.value, chatter.maxInputTokens);


        let paragraphs = getSessionParagraphs(sessionURL.value);

        let speakers = getSessionSpeakers(sessionId);

        let totalUsage: ModelUsage = { tokensIn: 0, tokensOut: 0, cost: 0 };
        for (let paragraph of paragraphs) {
            totalUsage.tokensIn += paragraph.usage.tokensIn;
            totalUsage.tokensOut += paragraph.usage.tokensOut;
            totalUsage.cost += paragraph.usage.cost;
        }

        let context: AIMessage[] = [];
        let remainingLimit = tokenLimit;
        function addMessage(role: "user" | "assistant", content: string) {
            let tokens = countTokens(content);
            if (remainingLimit < tokens) return true;
            remainingLimit -= tokens;
            context.unshift({ role, content });
        }
        let paragraphIncluded = new Set<Paragraph>();
        for (let i = paragraphs.length - 1; i >= 0; i--) {
            let paragraph = paragraphs[i];
            if (addMessage("assistant", paragraph.answer)) break;
            if (addMessage("user", paragraph.question)) break;
            paragraphIncluded.add(paragraph);
        }

        let input = this.input;
        async function runQuestion(question: string) {
            setTimeout(() => input?.focus());
            let newParagraph: Paragraph = {
                _id: nextId(),
                question: question,
                answer: "",
                orderTime: Date.now(),
                usage: { tokensIn: 0, tokensOut: 0, cost: 0 }
            };
            await setSessionParagraph(sessionId, newParagraph);

            let fullContext = context.slice();
            fullContext.push({ role: "user", content: question });
            let remainingContext = tokenLimit;
            let includedCount = 0;
            for (let i = fullContext.length - 1; i >= 0; i--) {
                let message = fullContext[i];
                let tokens = countTokens(message.content);
                if (remainingContext < tokens) break;
                remainingContext -= tokens;
                includedCount++;
            }
            fullContext = fullContext.slice(-includedCount);


            let usageObj = { input: 0, output: 0 };
            await chatter.chat({
                messages: fullContext,
                usage: usageObj,
                max_tokens: +maxResponseTokens.value,
                stream(newOutput) {
                    let currentParagraph = getSessionParagraph(sessionId, newParagraph._id) || newParagraph;
                    currentParagraph.answer = newOutput;
                    void setSessionParagraph(sessionId, currentParagraph);
                },
            });

            let currentParagraph = getSessionParagraph(sessionId, newParagraph._id) || newParagraph;
            currentParagraph.usage = {
                tokensIn: usageObj.input,
                tokensOut: usageObj.output,
                cost: usageObj.input / chatter.cost.inputTokensPerUSD + usageObj.output / chatter.cost.outputTokensPerUSD,
            };
            void setSessionParagraph(sessionId, currentParagraph);
        }
        async function segment(paragraph: Paragraph) {
            let segments = await segmentSpeakers({
                text: paragraph.answer,
                existingSpeakers: Object.keys(speakers.speakers),
                chatter,
            });

            paragraph.speakerSegmentation = segments;
            await setSessionParagraph(sessionId, paragraph);

            for (let segment of segments) {
                if (segment.speaker in speakers.speakers) continue;
                speakers.speakers[segment.speaker] = await pickGoodSpeaker({ segments });
            }
        }
        async function encode(paragraph: Paragraph) {
        }
        async function playAudio(paragraph: Paragraph) {
        }

        function getSpeakerHue(speaker: string) {
            let hue = 0;
            for (let char of speaker) {
                hue += char.charCodeAt(0);
            }
            return hue % 360;
        }

        return (
            <div className={css.vbox(10).pad2(20).fillWidth.maxHeight("100%").overflowHidden}>
                <Header />
                <Anchor params={[[pageURL, "sessionlist"]]}>
                    Back
                </Anchor>

                <div className={css.hbox(20)}>
                    <InputLabelURL
                        label="Token Limit Override"
                        persisted={tokenLimitURL}
                    />
                    <InputLabelURL
                        label="Max Response Tokens"
                        persisted={maxResponseTokens}
                    />
                    <div>(Limit {tokenLimit})</div>
                    <div>Remaining Limit {remainingLimit}</div>
                    <div>Input used {formatNumber(totalUsage.tokensIn)}</div>
                    <div>Output used {formatNumber(totalUsage.tokensOut)}</div>
                    <div>Input tokens per USD {formatNumber(chatter.cost.inputTokensPerUSD)}</div>
                    <div>Output tokens per USD {formatNumber(chatter.cost.outputTokensPerUSD)}</div>
                    <div>Cost {(totalUsage.cost * 100).toFixed(2)} cents</div>

                    {this.synced.lastDelete && <button onClick={() => undeleteSessionParagraph(sessionId, this.synced.lastDelete)}>Undelete</button>}
                </div>

                <div>
                    todonext; display speakers, and give a dropdown per to change the speaker;
                    add a "delete unused" button if a speaker is not used in any segment;
                    add a "rename" button, which uses a popup (just prompt is fine...), to ask for a new name, and renames it throughout all paragraphs
                    {JSON.stringify(speakers)}
                </div>


                <div className={css.vbox(20).fillWidth.overflowAuto.minHeight(0).margins2(20, 40).paddingRight(20)} ref={e => {
                    // Scroll to bottom
                    if (e) e.scrollTop = e.scrollHeight;
                }}>
                    {paragraphs.map(paragraph =>
                        <div className={css.vbox(5).fillWidth + (!paragraphIncluded.has(paragraph) && css.opacity(0.6))}>
                            <div className={css.hbox(10).fillWidth}>
                                {this.synced.editting === paragraph._id + "_question" &&
                                    dynamicTextArea({
                                        text: paragraph.question,
                                        onChange: async v => {
                                            this.synced.editting = "";
                                            return setSessionParagraph(sessionId, { ...paragraph, question: v });
                                        }
                                    })
                                    || <div
                                        onClick={() => this.synced.editting = paragraph._id + "_question"}
                                        className={css.whiteSpace("pre-wrap").hsla(200, 30, 10, 1).pad2(10, 10)}>
                                        {paragraph.question}
                                    </div>
                                }
                                <span>({formatNumber(countTokens(paragraph.question))} tokens)</span>
                                <button onClick={() => this.synced.editting = paragraph._id + "_question"}>Edit</button>
                            </div>
                            {!paragraph.speakerSegmentation && <div className={css.hbox(10).fillWidth}>
                                {this.synced.editting === paragraph._id + "_answer" &&
                                    dynamicTextArea({
                                        text: paragraph.answer,
                                        onChange: async v => {
                                            this.synced.editting = "";
                                            return setSessionParagraph(sessionId, { ...paragraph, answer: v });
                                        }
                                    })
                                    || <div
                                        onClick={() => this.synced.editting = paragraph._id + "_answer"}
                                        className={css.whiteSpace("pre-wrap").hsla(260, 30, 10, 1).pad2(10, 10)}>
                                        {paragraph.answer}
                                    </div>
                                }
                                <span>({formatNumber(countTokens(paragraph.answer))} tokens)</span>
                                <button onClick={() => this.synced.editting = paragraph._id + "_answer"}>Edit</button>
                            </div>}
                            {paragraph.speakerSegmentation && <div className={css.hbox(10).fillWidth}>
                                <div className={css.fillWidth.vbox(10)}>
                                    {paragraph.speakerSegmentation.map(segment =>
                                        <div className={
                                            css.hbox(10).wrap.fillWidth.hsl(getSpeakerHue(segment.speaker), 50, 50)
                                            + (segment.notAudible ? css.opacity(0.5).italic : "")
                                        }>
                                            <div>{segment.speaker}</div>
                                            <div>{segment.text}</div>
                                        </div>
                                    )}
                                </div>
                                <button onClick={() => { this.synced.editting = paragraph._id + "_answer"; this.synced.hideSpeakerSegments = true; }}>Edit</button>
                            </div>}
                            <div className={css.fillWidth.hbox(10)}>
                                <button onClick={() => segment(paragraph)}>Segment</button>
                                <button onClick={() => encode(paragraph)}>Encode</button>
                                {paragraph.audio && <button onClick={() => playAudio(paragraph)}>Play</button>}

                                {paragraph.speakerSegmentation && <button onClick={() => this.synced.hideSpeakerSegments = !this.synced.hideSpeakerSegments}>
                                    {this.synced.hideSpeakerSegments ? "Show" : "Hide"} Speaker Segments
                                </button>}

                                <div className={css.marginAuto} />
                                <div>{(paragraph.usage.cost * 1000).toFixed(2)} thousandths cents</div>
                                <button onClick={() => {
                                    this.synced.lastDelete = paragraph._id;
                                    return deleteSessionParagraph(sessionId, paragraph._id);
                                }}>Delete</button>
                            </div>
                        </div>
                    )}
                </div>

                <InputLabel
                    label="Question"
                    className={css.height(150)}
                    fillWidth
                    textarea
                    value={this.synced.editLast ? this.synced.editLastOverride : ""}
                    onChangeValue={async v => {
                        if (!v) return;
                        if (this.synced.editLast) {
                            this.synced.editLastOverride = "";
                            this.synced.editLast = false;
                            let last = paragraphs[paragraphs.length - 1];
                            if (last) {
                                await deleteSessionParagraph(sessionId, last._id);
                                context = context.slice(0, -1);
                            }
                        }
                        return runQuestion(v);
                    }}
                    inputRef={e => this.input = this.input || e}
                />
                <div className={css.hbox(50)}>
                    <button>
                        Ask
                    </button>

                    <button onClick={async () => {
                        let last = paragraphs[paragraphs.length - 1];
                        if (!last) return;
                        await deleteSessionParagraph(sessionId, last._id);
                        context = context.slice(0, -1);
                        await runQuestion(last.question);
                    }}>
                        Rerun Last
                    </button>

                    <button onClick={async () => {
                        let last = paragraphs[paragraphs.length - 1];
                        if (!last) return;
                        this.synced.editLast = true;
                        this.synced.editLastOverride = last.question;
                        setTimeout(() => input?.focus());
                    }}>
                        Edit Last
                    </button>

                    <InputLabel
                        label="Edit Last"
                        checkbox
                        checked={this.synced.editLast}
                        onChange={e => this.synced.editLast = e.currentTarget.checked}
                    />

                    <InputLabel
                        label="Hide Speaker Segments"
                        checkbox
                        checked={this.synced.hideSpeakerSegments}
                        onChange={e => this.synced.hideSpeakerSegments = e.currentTarget.checked}
                    />
                </div>

            </div>
        );
    }
}

