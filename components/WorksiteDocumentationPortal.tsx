import React from 'react';
import { WorksiteDocumentationPortal as WorksiteDocumentationPortalBase } from './WorksiteDocumentationPortalBase';
import { WorksiteMunicipalityPanel } from './WorksiteMunicipalityPanel';

export const WorksiteDocumentationPortal: React.FC = () => (
  <>
    <WorksiteDocumentationPortalBase />
    <WorksiteMunicipalityPanel />
  </>
);
