
import debugbreak from "debugbreak";
import { blue, magenta, red } from "socket-function/src/formatting/logColors";
import { isNode, PromiseObj } from "socket-function/src/misc";
import { AIMessage } from "../Schema";


if (isNode()) {
    const { forceTransformPackage } = (require as any)("typenode/compileFixESMTS");
    forceTransformPackage("llama3-tokenizer-js");
}
import llama3tokenizer from "llama3-tokenizer-js";
import { cacheLimited, lazy } from "socket-function/src/caching";
import { getAPIKey } from "./apiKeys";
import { addModelUsage } from "./globalUsage";


export type AIChatBot = {
    parallelCalls: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    cost: {
        inputTokensPerUSD: number;
        outputTokensPerUSD: number;
    };
    chat: (config: {
        messages: AIMessage[];
        max_tokens?: number;
        // Called with parts of output, as we receive them
        stream?: (fullOutput: string, newText: string) => void;
        json?: boolean;
        cancel?: { cancel: boolean };
    }) => Promise<string>;
};

export const countTokens = cacheLimited(10000, function countTokens(text: string): number {
    if (typeof text !== "string") {
        debugger;
    }
    return llama3tokenizer.encode(String(text)).length;
});
export function getMessageInputTokenCount(message: AIMessage) {
    // About 3 overhead per message
    return countTokens(message.content) + 3;
}

export type OpenAIService = {
    baseURL: string;
    headers: { [key: string]: string };
};

export const getChatGPTAPI = lazy(async function getChatGPTAPI(): Promise<OpenAIService> {
    return {
        baseURL: "https://api.openai.com/v1/",
        headers: {
            "Authorization": `Bearer ${await getAPIKey("openai")}`,
            "Content-Type": "application/json",
        }
    };
});
export const getPineconeAPI = lazy(async function getChatGPTAPI(): Promise<OpenAIService> {
    return {
        baseURL: "https://prod-1-data.ke.pinecone.io/assistant/chat/mgmt/",
        headers: {
            "Api-Key": await getAPIKey("pinecone_api_key"),
            "Content-Type": "application/json",
        }
    };
});

export function verifyType<Spec>() {
    return <T extends { [key: string]: Spec }>(value: T) => {
        return value;
    };
}

export const aiChatBots = verifyType<AIChatBot>()({
    test: {
        parallelCalls: 1,
        maxOutputTokens: 1024,
        maxInputTokens: 1024,
        cost: {
            inputTokensPerUSD: 10_000_000,
            outputTokensPerUSD: 1_000_000,
        },
        chat: async config => {
            let inputTokens = config.messages.map(getMessageInputTokenCount).reduce((a, b) => a + b, 0);
            addModelUsage({
                cost: inputTokens / 10_000_000,
                tokensIn: inputTokens,
                tokensOut: 0,
            });
            let result = JSON.stringify({
                messageCount: config.messages.length,
                inputTokens,
            });
            if (config.stream) {
                config.stream(result, result);
            }
            return result;
        },
    },
    llamaLocal: {
        parallelCalls: 1,
        maxOutputTokens: 8092,
        maxInputTokens: 8092,
        cost: {
            inputTokensPerUSD: 10_000_000,
            outputTokensPerUSD: 1_000_000,
        },
        chat: async config => {
            return await callAIChatBot({
                url: "http://127.0.0.1:8035/v1/chat/completions",
                messages: config.messages,
                headers: {},
                params: {
                    max_tokens: config.max_tokens,
                    response_format: config.json && { type: "json_object" } || undefined
                },
                stream: config.stream,
                cancel: config.cancel,
                inputTokensPerUSD: 10_000_000,
                outputTokensPerUSD: 1_000_000,
            });
        }
    },
    // 67K output tokens / USD, 200K input tokens / USD
    openai4o: {
        parallelCalls: 8,
        maxOutputTokens: 16 * 1000,
        maxInputTokens: 128 * 1024,
        cost: {
            inputTokensPerUSD: 200_000,
            outputTokensPerUSD: 67_000
        },
        chat: async config => {
            let api = await getChatGPTAPI();
            return await callAIChatBot({
                url: "https://api.openai.com/v1/chat/completions",
                messages: config.messages,
                headers: api.headers,
                params: {
                    model: "gpt-4o",
                    max_completion_tokens: config.max_tokens,
                    response_format: config.json && { type: "json_object" } || undefined
                },
                stream: config.stream,
                cancel: config.cancel,
                inputTokensPerUSD: 200_000,
                outputTokensPerUSD: 67_000,
            });
        }
    },
    // 1.6M output tokens / USD, 6.7M input tokens / USD
    openai4o_mini: {
        parallelCalls: 32,
        maxOutputTokens: 16 * 1000,
        maxInputTokens: 128 * 1024,
        cost: {
            inputTokensPerUSD: 6_700_000,
            outputTokensPerUSD: 1_600_000
        },
        chat: async config => {
            let api = await getChatGPTAPI();
            return await callAIChatBot({
                url: "https://api.openai.com/v1/chat/completions",
                messages: config.messages,
                headers: api.headers,
                params: {
                    model: "gpt-4o-mini",
                    max_completion_tokens: config.max_tokens,
                    response_format: config.json && { type: "json_object" } || undefined
                },
                stream: config.stream,
                cancel: config.cancel,
                inputTokensPerUSD: 6_700_000,
                outputTokensPerUSD: 1_600_000,
            });
        }
    },
    // 16.7K output tokens / USD, 66.7K input tokens / USD
    openai_o1_preview: {
        parallelCalls: 2,
        maxOutputTokens: 16 * 1000,
        maxInputTokens: 128 * 1024,
        cost: {
            inputTokensPerUSD: 66_700,
            outputTokensPerUSD: 16_700
        },
        chat: async config => {
            let api = await getChatGPTAPI();
            return await callAIChatBot({
                url: "https://api.openai.com/v1/chat/completions",
                messages: config.messages,
                headers: api.headers,
                params: {
                    model: "o1-preview",
                    max_completion_tokens: config.max_tokens,
                    response_format: config.json && { type: "json_object" } || undefined
                },
                stream: config.stream,
                cancel: config.cancel,
                inputTokensPerUSD: 66_700,
                outputTokensPerUSD: 16_700,
            });
        }
    },
    // 83K output tokens / USD, 333K input tokens / USD
    openai_o1_mini: {
        parallelCalls: 2,
        maxOutputTokens: 16 * 1000,
        maxInputTokens: 128 * 1024,
        cost: {
            inputTokensPerUSD: 333_000,
            outputTokensPerUSD: 83_000
        },
        chat: async config => {
            let api = await getChatGPTAPI();
            return await callAIChatBot({
                url: "https://api.openai.com/v1/chat/completions",
                messages: config.messages,
                headers: api.headers,
                params: {
                    model: "o1-mini",
                    max_completion_tokens: config.max_tokens,
                    response_format: config.json && { type: "json_object" } || undefined
                },
                stream: config.stream,
                cancel: config.cancel,
                inputTokensPerUSD: 333_000,
                outputTokensPerUSD: 83_000,
            });
        }
    },
    // 66.7K output tokens / USD, 125K input tokens / USD
    pinecone: {
        parallelCalls: 2,
        maxOutputTokens: 16 * 1000,
        maxInputTokens: 128 * 1024,
        cost: {
            inputTokensPerUSD: 125_000,
            outputTokensPerUSD: 66_700
        },
        chat: async config => {
            let api = await getPineconeAPI();
            return await callAIChatBot({
                url: "https://prod-1-data.ke.pinecone.io/assistant/chat/mgmt/chat/completions",
                messages: config.messages,
                headers: api.headers,
                params: {
                    max_tokens: config.max_tokens,
                },
                stream: config.stream,
                cancel: config.cancel,
                inputTokensPerUSD: 125_000,
                outputTokensPerUSD: 66_700,
            });
        }
    },
});


function timeoutToError<T>(time: number, p: Promise<T>, err: () => Error) {
    return new Promise<T>((resolve, reject) => {
        let timeout = setTimeout(() => reject(err()), time);
        p.then(resolve, reject).finally(() => clearTimeout(timeout));
    });
}
export async function callAIChatBot(config: {
    url: string;
    messages: AIMessage[];
    headers: { [key: string]: string };
    params?: { [key: string]: unknown | undefined };
    stream?: (fullOutput: string, newOutput: string) => void;
    cancel?: { cancel: boolean };
    json?: boolean;
    inputTokensPerUSD: number,
    outputTokensPerUSD: number,
}): Promise<string> {
    let { messages, stream, cancel } = config;
    let retries = 0;
    while (true) {
        try {
            let abortController = new AbortController();
            // NOTE: fetch gives braindead errors, without the HTTP code and just a sanitized "fetch failed",
            //  with the additional information hidden... somewhere? So we're using requestRaw...
            let fetchPromise = fetch(config.url, {
                method: "POST",
                body: Buffer.from(JSON.stringify({
                    messages,
                    stream: !!stream,
                    ...Object.fromEntries(Object.entries(config.params ?? {}).filter(([_, v]) => v !== undefined)),
                })),
                headers: {
                    "Content-Type": "application/json",
                    ...config.headers,
                },
                signal: abortController.signal,
            });

            fetchPromise = timeoutToError(1000 * 60, fetchPromise, () => new Error(`AI timeout`));
            let result = await fetchPromise;

            let finalResult: {
                choices: {
                    message: AIMessage;
                }[];
                usage: { completion_tokens: number, prompt_tokens: number, total_tokens: number };
            } | {
                error: { message: string; type: string; };
            } | undefined;

            if (stream) {
                let callback = stream;
                let curFullResult = "";
                function onLine(line: string) {
                    line = line.trim();
                    if (!line.startsWith("data: ")) return;
                    if (line === "data: [DONE]") return;
                    let data = JSON.parse(line.slice("data: ".length)) as {
                        choices: {
                            delta: {
                                content: string;
                            };
                            message: AIMessage;
                        }[];
                    };
                    let newData = data.choices[0].delta.content;
                    if (!newData) return;
                    curFullResult += newData;
                    callback(curFullResult, newData);
                }
                let reader = result.body?.getReader();
                if (!reader) throw new Error("No body in response to our request");
                let decoder = new TextDecoder();
                let pending = "";
                while (true) {
                    let { done, value } = await reader.read();
                    if (done) {
                        break;
                    }
                    if (cancel?.cancel) {
                        // Closing the connection saves us some tokens (apparently)
                        abortController.abort();
                        await reader.cancel();
                        break;
                    }
                    let newText = decoder.decode(value, { stream: true });
                    pending += newText;
                    let lines = pending.split("\n");
                    for (let i = 0; i < lines.length - 1; i++) {
                        try {
                            onLine(lines[i]);
                        } catch (e) {
                            // Ignore JSON parse errors. Why does the API include non-json responses mixed in with JSON?
                            if (!String(e).includes("SyntaxError")) throw e;
                        }
                    }
                    pending = lines[lines.length - 1];
                }
                // have to guess the tokens I guess...
                let outputTokens = countTokens(curFullResult);
                let inputTokens = messages.map(getMessageInputTokenCount).reduce((a, b) => a + b, 0);
                finalResult = {
                    choices: [{
                        message: {
                            role: "assistant",
                            content: curFullResult,
                        }
                    }],
                    usage: {
                        completion_tokens: outputTokens,
                        prompt_tokens: inputTokens,
                        total_tokens: inputTokens + outputTokens,
                    },
                };
            } else {
                let output = Buffer.from(await result.arrayBuffer());
                finalResult = JSON.parse(output.toString());
            }
            if (!finalResult) throw new Error("Did not receive API response");

            let obj = finalResult;
            if ("error" in obj) {
                throw new Error(obj.error.message + " " + obj.error.type);
            }

            let input = obj.usage.prompt_tokens;
            let output = obj.usage.completion_tokens;
            let cost = input / config.inputTokensPerUSD + output / config.outputTokensPerUSD;
            addModelUsage({
                cost,
                tokensIn: input,
                tokensOut: output,
            });

            console.log(magenta(obj.choices[0].message.content));
            let message = obj.choices[0].message as any || "";
            return message.refusal ?? message.content;
        } catch (e) {
            retries++;
            // NOTE: This often happens when debugging. I think fetch is keeping the TCP connection
            //  alive. Which is useful, but we should retry, so we can step through without
            //  crashing the application.
            if (
                retries < 10
                && (
                    String(e).includes("ECONNRESET")
                    || String(e).includes("ECONNREFUSED")
                    || String(e).includes("AI timeout")
                    || String(e).includes("quota_error")
                    || String(e).includes("auth_subrequest_error")
                    || String(e).includes("Timed out generating response")
                    //|| String(e).includes("SyntaxError")
                )

            ) {
                console.log(red(`Retryable error, retrying in 5 seconds`), e);
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }
            throw e;
        }
    }
}