// Comprehensive Global Document Knowledge Base for SearchFix Title Examination AI
// Covers all standard document types, their purposes, key content elements, and analytical rules.

export const DOCUMENT_KNOWLEDGE = `GLOBAL DOCUMENT KNOWLEDGE & ONTOLOGY FOR TITLE EXAMINATION:

1. TA (Typing Assistant):
   - Definition & Role: Raw draft / rough notes prepared by the search/typing team prior to standardized report generation. In this business, TA represents the draft working notes, whereas TYPED_REPORT is the final standardized product.
   - Typical Format: Plain text (.txt) in the Attachment Viewer.
   - Typical Contents: Structured sections including --Internal Comments--, EFFECTIVE DATE, --Property Info-- (Parcel ID, County, Vesting, Legal Description references), --General Tax Information--, --Assessed Values-- (Land, Improvements, Total), --Deeds--, --Mortgages/DOT--, --Names Searched--, and --Comments--.
   - Rule: Check order attachments first for .txt TA. Only navigate to the external Typing Assistant tool link if TA is not attached.

2. TYPED_REPORT (Standardized Title Search Report / Current Owner Summary):
   - Definition & Role: The final standardized title report produced by our company for the client (e.g., Vylla Informational Summary, TitleVision Current Owner Report). Its contents are standardized from the TA.
   - Typical Contents: Vesting clause, conveyance deed details (grantor, grantee, book/page, dates), voluntary liens/mortgages schedule, involuntary liens/judgments/FiFa, tax status summary, and Exhibit A legal description.
   - Rule: For typing discrepancy claims, compare TYPED_REPORT against TA and recorded instruments.

3. SEARCH_PACKAGE (Recorded Documents Bundle / Standalone Recorded Instruments):
   - Definition & Role: The primary title evidence package containing scanned official county recorded instruments (Warranty Deeds, Quitclaim Deeds, Mortgages/Deeds of Trust, Releases, Assignments, Modifications, Subordinations, Affidavits, Lis Pendens).
   - Typical Contents: Recorded instruments bearing county recorder stamps, book/page, instrument/CFN numbers, execution/recording dates, legal descriptions, consideration amounts, and notary acknowledgments.
   - Standalone vs. Bundle: When a separate recorded deed or document is attached individually (e.g., "1993-028775.pdf" or "Warranty Deed.pdf"), analyze it directly. If not attached separately, search within the multi-page Search Package.
   - Recency / Versioning: If multiple Search Packages exist in attachments, always select the most recent one for analysis.

4. TAX (Property Tax Overview, Tax Bills & Automated Tax Certificates):
   - Definition & Role: Official municipal/county tax documentation and commercial tax certificates (e.g., Cook County Treasurer Bill, First American TaxSource Report).
   - Typical Contents: Parcel Index Number (PIN/APN), assessed land/building values, Equalized Assessed Value (EAV), tax years, installment schedule (1st and 2nd installments), amounts billed/paid, balance due, delinquency warnings, tax exemptions (Homeowner, Senior), payment receipts, and tax sale redemption status.
   - Rule: Distinguish billed installments from paid balances, and compare the exact corresponding tax years.

5. PA (Property Assessor Card / Property Record Card / PRC):
   - Definition & Role: County Tax Assessor property card (e.g., Beacon, Schneider Geospatial, County Assessor snapshot).
   - Typical Contents: Property classification (SFR, agricultural), physical dwelling specs (year built, square footage, rooms, exterior frame, detached structures/garages), assessment valuations across multiple years, tax history charges, deductions, and deed transfer history.
   - Rule: Assessor ownership and physical card details provide assessment context but do not substitute for a recorded vesting deed.

6. THR (Transaction History Report / TitleFlex / DataTree):
   - Definition & Role: Chronological transaction summary report providing historical title chain data.
   - Typical Contents: Current owner and vesting, chronological deed transfers (sales dates, amounts, parties, doc numbers), trust deeds/mortgages (amounts, interest rates, terms, loan types like FHA/Conventional), and linked releases.
   - Rule: THR provides historical transaction continuity but does not replace recorded instrument verification.

7. INDEX (County Clerk / Recorder Search Results & Title Plant Name Runs):
   - Definition & Role: Search printouts from county recording offices or title plant systems (e.g., Cook County Clerk index, TitleVision GI search, DataSource Johnson County).
   - Typical Contents: Document numbers, recording dates, execution dates, document types, grantor/grantee names, PIN, and cross-references to linked releases/satisfactions.
   - Rule: Search index entries prove search scope and recording references; verify underlying instruments for terms and legal descriptions.

8. ATTORNEY_OPINION (Attorney Title Opinion / Title Certification / ATO):
   - Definition & Role: Formal legal certification signed by a licensed real estate attorney certifying marketable title based on public records review.
   - Typical Contents: Vesting conveyance, property identification, ad valorem tax status, plat book/page, restrictive covenants, open mortgages schedule, assignments, FiFa / encumbrances list, Exhibit A legal description, Attorney Signature, and State Bar number.

9. LEGAL_DESCRIPTION (Exhibit A / Standalone Boundary Document):
   - Definition & Role: Metes-and-bounds or lot/block platted real property boundary description defining the subject parcel.
   - Typical Contents: Lot/block numbers, subdivision name, section/phase, Plat Book & Page references, Certificate of Amendment instrument numbers, standard property address, and PIN.

10. VENDOR_MANAGEMENT (Order Instructions / Real Estate Request Form / Client Specs):
    - Definition & Role: Client intake work order (e.g., Doma Real Estate Request Form, Vendor Management PDF, Client Guidelines) defining required search depth, custom typing codes (e.g., LN1070 for no open mortgage), copy requirements, and special search rules.
    - Typical Contents: Order number, product type (Current Owner, Two Owner, Full Search), SLA due date, borrower name, property address, core search specs (FVD/24-month deed chain, tax requirements, open mortgage rules, map requirements, bankruptcy/PACER requirements, OFAC/Patriot search requirements).
    - VM Requirement Analysis: When verifying "As per VM requirement" claims, inspect the VM document to verify whether the client explicitly mandated the specific search or attachment for this order's product type.

11. LIEN (Court Docket, Civil Judgment, FiFa & State Tax Warrant Searches):
    - Definition & Role: Municipal, county, and state court searches checking for active judgments, civil lawsuits, small claims, and tax warrants (e.g., Doxpop, Odyssey).
    - Typical Contents: Case/docket numbers, party roles (Plaintiff vs. Defendant), case types, filing dates, disposition dates, case status (Open vs. Closed), tax warrant liability amounts.

12. PACER (Bankruptcy Search Report):
    - Definition & Role: Federal bankruptcy court search report checking whether owners or borrowers have filed Chapter 7, 11, or 13 bankruptcy.
    - Typical Contents: Debtor/Defendant Name, Search Date, Case Number (or NONE), Court ID, Court State, filing date, and discharge status.

13. PATRIOT (Patriot Act / OFAC / Sanctions Search Report):
    - Definition & Role: Federal anti-terrorism and sanctions screening report verifying borrowers/buyers against the US Treasury OFAC Specially Designated Nationals (SDN) list.
    - Typical Contents: Name searched, lookup parameters, match score, result status ("0 Found / Your search has not returned any results"), and list update date.

14. MAP (GIS / Parcel Map / Plat Map / Aerial Boundary Map):
    - Definition & Role: Visual boundary map showing parcel placement, lot lines, road frontage, and adjoining parcels (e.g., Mapbox, County GIS, Plat Book copy).

15. CHECKLIST (No Open Mortgage Checklist & Marked-up Index):
    - Definition & Role: Standard operating procedure (SOP) audit checklist uploaded when no open mortgage is found on the Property In Question (PIQ), with marked-up index pages linking mortgages to releases and required internal note: "INTERNAL: NO MORTGAGE CHECKLIST COMPLETED WITH NO OPEN MORTGAGE LOCATED".

16. PROPERTY_REPORT (Title Update / Bring-Down / Property Overview):
    - Definition & Role: Bring-down / date-down report checking for any new recordings or tax changes between original effective date and current search date (e.g., Vylla Update Report).

17. HOA_DOCUMENT (Homeowners Association / Covenants, Conditions & Restrictions):
    - Definition & Role: HOA declarations, bylaws, assessments, or recorded CC&Rs governing the subdivision.

18. LIEN_REGISTRY (State/County Lien Registry Records):
    - Definition & Role: Dedicated state or county lien registry search results for mechanics liens, municipal liens, and environmental liens.

19. COVER_SHEET (Abstractor Search Notes & Summary Cover Sheet):
    - Definition & Role: Abstractor search cover page summarizing order identifiers, search date range, names searched in Grantor/Grantee and General Index, and brief instrument schedule.

20. COST_WORKSHEET (DTNP Search Cost & Abstractor Fee Sheet):
    - Definition & Role: Search cost accounting breakdown detailing online fees, abstractor labor fees, and document copy costs.

ANALYTICAL RULES & WORKFLOW LOGIC:
- DYNAMIC DOCUMENT SELECTION: Document selection is dynamic and contextual. Do not rely on fixed hardcoded issue-to-document lookup tables. Evaluate the client comment and claim against the available order attachments and global document knowledge.
- "AS PER VM REQUIREMENT" CLAIMS (Two-Step Verification Matrix):
  * When a client comment alleges that a document/search is required "As per VM requirement" (or per vendor guidelines):
    - Case 1 (ACCEPTED): VM document explicitly mandates the requirement, and the document is absent from order attachments.
    - Case 2 (DISPUTED): VM document mandates the requirement, but the document is already attached in the order.
    - Case 3 (DISPUTED): VM document does NOT mandate the claimed search/document for this product/order.
    - Case 4 (REVIEW_REQUIRED): VM document is missing from attachments or cannot be verified.
- STANDALONE MISSING ATTACHMENT CLAIMS (without VM reference):
  * When a client comment claims a missing attachment without referencing VM requirements (e.g., "Missed to attach PACER", "Tax not available in attachments", "Deed not attached"):
    - If the document is present in the order attachments -> DISPUTED (the document is already attached).
    - If the document is verified to be absent from the order attachments -> ACCEPTED (the document was missed and must be provided).
- UNRELIABLE NAMES & DOC TYPES: Document filenames and system doc types in real orders are often abbreviated, inconsistent, or non-standard. The AI must use contextual understanding of global document roles rather than brittle exact string matching.
- RECENCY & DEDUPLICATION: If multiple versions of a document or search package are attached, always select the most recent version for analysis.
- MISSING EVIDENCE PRINCIPLE: If a discrepancy claim requires document analysis and the necessary document is absent from both attachments and search packages, the outcome must be REVIEW_REQUIRED.
`;
