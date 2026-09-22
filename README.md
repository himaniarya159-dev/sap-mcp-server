# SAP MCP Server

A hands-on Model Context Protocol (MCP) server built with Node.js as part of an SAP BTP integration project.

## Project Overview

This project demonstrates how an MCP server can expose business functionality as tools that can be invoked by an MCP client.

The initial version provides a simple customer lookup tool.

## Architecture

```text
MCP Client
    |
    v
Node.js MCP Server
    |
    v
get_customer Tool
    |
    v
Customer Data