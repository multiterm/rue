const labels=new Map([['openai','OpenAI'],['anthropic','Anthropic'],['google','Google'],['openrouter','OpenRouter'],['openai-codex','OpenAI Codex']])
export const providerName=(id:string)=>labels.get(id)??id
