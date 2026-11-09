# Project Knowledge – NEAR Transaction Risk Agent

This agent is built for the NEAR Hackathon.

## Purpose

Help users and other agents detect risky or suspicious transactions before they are signed or executed, especially in cross-chain and intent-based flows.

## Key NEAR Context

- NEAR supports named accounts and implicit accounts
- NEAR Intents enable cross-chain execution
- Function Call Access Keys allow limited permissions (important for agent security)
- The project aligns with the "AI Security & Defense" track and can also touch Agents / DeFi tracks

## Design Goals

- Fast extraction of transaction details
- Transparent risk scoring (0-100)
- Human-readable explanations
- Strong resistance to prompt injection
- Knowledge-driven decisions (this folder)

## Limitations

- Currently does not perform live on-chain lookups unless explicitly connected
- Relies on patterns, rules, and LLM reasoning over the provided knowledge

