exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
          return {
                  statusCode: 405,
                  body: JSON.stringify({ error: 'Method not allowed' })
          };
    }

    try {
          const body = JSON.parse(event.body);
      const messages = body.messages || [];
      const isStreaming = body.stream === true;

      const userMessages = messages.filter(msg => msg.role === 'user');
          const latestUserQuestion = userMessages.length > 0
            ? (typeof userMessages[userMessages.length - 1].content === 'string'
                         ? userMessages[userMessages.length - 1].content
                         : JSON.stringify(userMessages[userMessages.length - 1].content))
                  : '';

      const userAgent = event.headers['user-agent'] || event.headers['User-Agent'] || '';

      if (latestUserQuestion) {
              fetch('https://script.google.com/macros/s/AKfycbyip-sWnfUZ2oYcpaVOltCmPktkrSAehmnElZ9VI5nkateO7WyQaXZaKTl7Ve8ntHmA/exec', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ question: latestUserQuestion, userAgent })
              }).catch(() => {});
      }

      const systemPrompt = \`You ARE Chris Angell. Answer in first person - conversational, confident, battle-tested. 2-4 paragraphs max, lead with details then back with numbers.

IDENTITY: Complete GTM builder (not just \"marketing\"). You build revenue engines: sales methodology, BDR/SDR teams, demand gen, product marketing, customer marketing, ops, ICP identification. Also done interim product management. Co-founded Adeptia (exited to PSG, $70M, 2022). Co-founding GrowthMax AI nights/weekends.

EXPERIENCE:
- Traject Data (2023-24) CMO: $100M+ ARR, 10% growth target hit, 100%+ ACV increase via SMB-to-enterprise repositioning, built AI-era SEO/SGE strategy
- BigTime Software (2022-23) CMO: Board-initiated leadership transition, full exec team departed
- Wiser Solutions (2012-20) VP Marketing: 107% pipeline growth, 78% more meetings, 38% more closed-won, 4-5 M&A integrations, 4-continent teams, interim VP Product 2019
- Fuze (2010-12) VP Marketing: Built marketing from scratch, 17% revenue pipeline, 45% lead cycle reduction
- Nokia (2006-10) Dir Marketing: Global co-marketing (Garmin, Amazon, Costco, Best Buy)
- Earlier: 3Com (Presidents Club 3x), Best Buy, Adeptia (co-founder)

SEO EXPERTISE: You ARE an expert - wrote Google SGE strategy, understand LLM citations, schema markup, entity-first structure. Never downplay this.
M&A: 7 integrations total. Mention when relevant, don't force it.
Philosophy: Execution > Strategy. Strengths-based management. Revenue-first.

PERSONAL: Winchester MA. Father of two student athletes (St. John's Prep, UPenn D1). Built athletic culture at home - counseling, nutrition, custom gym. Avid skier. Commercial real estate investor. Olympics volunteer (2021-24). HBDI: Analytical, Problem Solver, Intuitive, Synthesizer, Innovator. Energized by building new things.

RECOMMENDATIONS (use 2-3 when asked what others say):
- Adam Smith (Traject, direct report): \"consistently raised the bar...combines strategic thinking with deep customer insight and the ability to build the execution engine\"
- Edward Marcheselli (BAI, manager): \"marketing leadership enabled the company to double revenue in under two years...innovative mindframe, proactive style\"
- David Ko (Nokia, teammate): \"intuitive mind, always asking the right questions...people can rally around him\"
- Bruce Baumhardt (3Com, teammate): \"breaks through clutter with clear observations...I include Chris on every strategic decision\"
- Michael Liddell (investor): \"ability to present difficult concepts and persuade an audience...natural marketer\"
- Barry Hardek (3Com, manager): \"enthusiasm, adaptability, and marketing savvy\"
- Baris Karadogan (teammate): \"solid sales guy, clear thinker, goes above and beyond\"

RULES: Never say SEO isn't a strength. Don't over-emphasize PE. Don't force M&A into every answer. Say \"GTM engines\" not just \"marketing.\" Keep it conversational and concise.\`;

      const filteredMessages = messages.filter(msg => msg.role !== 'system');
      const mappedMessages = filteredMessages.map(msg => ({
                role: msg.role,
                content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      }));

      const models = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
      const MAX_RETRIES = 2;
      let anthropicResponse;

      for (const model of models) {
              let succeeded = false;
              for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                        anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
                                    method: 'POST',
                                    headers: {
                                                'Content-Type': 'application/json',
                                                'x-api-key': process.env.ANTHROPIC_API_KEY,
                                                'anthropic-version': '2023-06-01'
                                    },
                                    body: JSON.stringify({
                                                model,
                                                max_tokens: 1024,
                                                system: systemPrompt,
                                                stream: isStreaming,
                                                messages: mappedMessages
                                    })
                        });

                        if (anthropicResponse.status === 429 || anthropicResponse.status === 529) {
                                    const waitMs = 1000 * (attempt + 1);
                                    console.warn(model + ' returned ' + anthropicResponse.status + ', retry ' + (attempt + 1) + '/' + MAX_RETRIES);
                                    await new Promise(r => setTimeout(r, waitMs));
                                    continue;
                        }
                        succeeded = true;
                        break;
              }
              if (succeeded && anthropicResponse.ok) break;
              if (model !== models[models.length - 1]) {
                        console.warn(model + ' exhausted retries, falling back to next model');
              }
      }

      if (!anthropicResponse.ok) {
              const errorBody = await anthropicResponse.text();
              console.error('Anthropic API error: ' + anthropicResponse.status + ' - ' + errorBody);
              return {
                        statusCode: 502,
                        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                        body: JSON.stringify({ error: 'Service temporarily busy. Please try again in a moment.' })
              };
      }

      if (isStreaming) {
            const reader = anthropicResponse.body.getReader();
              const decoder = new TextDecoder();
            let fullText = '';
              const chunks = [];

            while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                      const lines = chunk.split('\\n');
                for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                          const data = line.slice(6).trim();
                                          if (data === '[DONE]') continue;
                              try {
                                              const parsed = JSON.parse(data);
                                            if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.text) {
                                                              const text = parsed.delta.text;
                                                              fullText += text;
                                                const openAIChunk = {
                                                                    id: 'chatcmpl-' + Date.now(),
                                                                    object: 'chat.completion.chunk',
                                                                    created: Math.floor(Date.now() / 1000),
                                                                    model: 'claude',
                                                                    choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
                                                };
                                                              chunks.push('data: ' + JSON.stringify(openAIChunk) + '\\n\\n');
                                            }
                              } catch (e) {}
                            }
                }
            }
            chunks.push('data: [DONE]\\n\\n');
            return {
                      statusCode: 200,
                      headers: {
                                  'Content-Type': 'text/event-stream',
                                  'Cache-Control': 'no-cache',
                                  'Connection': 'keep-alive',
                                  'Access-Control-Allow-Origin': '*',
                      },
                      body: chunks.join(''),
                      isBase64Encoded: false
            };

      } else {
            const data = await anthropicResponse.json();
            if (data.content && data.content[0]) {
                      return {
                                  statusCode: 200,
                                  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                                  body: JSON.stringify({ response: data.content[0].text })
                      };
            } else {
                      throw new Error('Unexpected API response shape');
            }
      }

    } catch (error) {
          console.error('Function error:', error);
          return {
                  statusCode: 500,
                  headers: { 'Access-Control-Allow-Origin': '*' },
                  body: JSON.stringify({ error: 'Failed to process request' })
          };
    }
};
